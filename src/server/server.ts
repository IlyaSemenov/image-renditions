import { assertInteger } from "../assert"
import type { RenditionTarget } from "../catalog"
import { hashRecipe } from "../hash"
import { isSafePath } from "../path"
import { formatExtensions, type Recipe, type RenditionFormat } from "../recipe"

import { type Coordinator, createLocalCoordinator } from "./coordinator"
import { RenditionError } from "./error"
import { createLimiter } from "./limiter"
import type { Processor } from "./processor"
import {
  createMemoryReadinessIndex,
  type MemoryReadinessIndexOptions,
  type ReadinessIndex,
} from "./readiness"
import type { ResultStore, SourceStore } from "./stores"

/** Storage locations of a source and its renditions. */
export interface SourceResolution {
  /** Key of the source object in the source store. */
  sourceKey: string
  /**
   * Key prefix of every rendition of the source; a rendition is stored at `<resultPrefix>/<hash>.<extension>`.
   *
   * Defaults to `sourceKey`, which suits a result store separate from the source store.
   * Different sources must have different prefixes, and in a store shared with sources the prefixes must stay apart from source keys, such as under `renditions/`.
   */
  resultPrefix?: string
}

/** Options of {@link createRenditionServer}. */
export interface RenditionServerOptions<Context> {
  source: SourceStore
  results: ResultStore
  processor: Processor
  /**
   * Maps a target to storage locations within the application context, such as a tenant.
   *
   * Returns `undefined` when the target must not be served, for example an unknown scope.
   * Targets of different scopes must map to different locations even when their paths are equal.
   * By default an unscoped path is the source key, and scoped targets are not served.
   */
  resolveSource?(
    target: RenditionTarget,
    context: Context,
  ): SourceResolution | undefined | Promise<SourceResolution | undefined>
  readiness?: {
    /** Process-local index consulted first. */
    memory?: MemoryReadinessIndexOptions
    /**
     * Index shared between replicas, consulted after the memory index.
     *
     * Each call gets an abort signal that fires after `limits.indexTimeout`; the server stops waiting then, even if the call goes on.
     */
    shared?: ReadinessIndex
  }
  /** Merges work on the same rendition; process-local by default. */
  coordinator?: Coordinator
  limits?: {
    /** Renditions processed at once, including their source download. */
    concurrency?: number
    /** Renditions waiting for a processing slot; more fail as `overloaded`. */
    queueSize?: number
    /** Milliseconds a rendition may wait for a processing slot before it fails as `overloaded`. */
    queueTimeout?: number
    /** Milliseconds each storage call may take before it fails; the store receives an abort signal to cancel its work. */
    storageTimeout?: number
    /** Milliseconds each shared readiness index call may take before it counts as failed; the index receives an abort signal to cancel its work. */
    indexTimeout?: number
  }
  /**
   * Receives errors that do not fail the operation, such as an unavailable shared readiness index.
   *
   * It is not awaited, and its own failures are ignored.
   */
  onError?(error: unknown): void
}

/** Published rendition. */
export interface Rendition {
  /** Key in the result store. */
  key: string
  /** Public URL. */
  url: string
}

/** Generates renditions and finds published ones. */
export interface RenditionServer<Context> {
  /**
   * Makes sure the rendition of a target is published and returns it.
   *
   * Resolves only after the rendition is written or confirmed to exist.
   *
   * @throws {RenditionError} When the rendition cannot be published.
   */
  ensure(recipe: Recipe, target: RenditionTarget, context: Context): Promise<Rendition>
  /**
   * Finds a rendition by recipe hash in the readiness indexes, without any storage call.
   *
   * Serves renditions of recipes the catalog no longer contains.
   *
   * @throws {RenditionError} Of reason `invalid-request` when the target is rejected.
   */
  findPublished(
    hash: string,
    format: RenditionFormat,
    target: RenditionTarget,
    context: Context,
  ): Promise<Rendition | undefined>
}

/** Longest delay of Node timers, in milliseconds. */
const MAX_TIMEOUT = 2 ** 31 - 1

/**
 * Creates a rendition server over source and result stores.
 *
 * @throws {RangeError} When a limit is not an integer in its range.
 */
export function createRenditionServer<Context>(
  options: RenditionServerOptions<Context>,
): RenditionServer<Context> {
  const { source, results, processor, resolveSource = resolveUnscoped, onError } = options
  const memory = createMemoryReadinessIndex(options.readiness?.memory)
  const shared = options.readiness?.shared
  const coordinator = options.coordinator ?? createLocalCoordinator()
  const {
    concurrency = 2,
    queueSize = 100,
    queueTimeout = 30_000,
    storageTimeout = 15_000,
    indexTimeout = 1000,
  } = options.limits ?? {}
  assertInteger("limits.concurrency", concurrency, 1, Number.MAX_SAFE_INTEGER)
  assertInteger("limits.queueSize", queueSize, 0, Number.MAX_SAFE_INTEGER)
  assertInteger("limits.queueTimeout", queueTimeout, 1, MAX_TIMEOUT)
  assertInteger("limits.storageTimeout", storageTimeout, 1, MAX_TIMEOUT)
  assertInteger("limits.indexTimeout", indexTimeout, 1, MAX_TIMEOUT)
  const limiter = createLimiter({ concurrency, queueSize, queueTimeout })

  async function locate(
    hash: string,
    format: RenditionFormat,
    target: RenditionTarget,
    context: Context,
  ) {
    const resolution = await resolveSource(target, context)
    if (!resolution) {
      throw new RenditionError("invalid-request", `The target ${describe(target)} is not served.`)
    }
    const prefix = resolution.resultPrefix ?? resolution.sourceKey
    const key = `${prefix}/${hash}.${formatExtensions[format]}`
    // Keys come from application code, so they are checked like client input to keep storage paths unambiguous.
    if (!isSafePath(resolution.sourceKey) || !isSafePath(key)) {
      throw new RenditionError(
        "invalid-request",
        `The target ${describe(target)} resolves to an unsafe key.`,
      )
    }
    return { sourceKey: resolution.sourceKey, rendition: { key, url: results.url(key) } }
  }

  async function isIndexed(url: string) {
    if (memory.has(url)) {
      return true
    }
    const found = await callShared(signal => shared?.has(url, { signal }))
    if (found) {
      memory.add(url)
    }
    return found === true
  }

  async function markPublished(url: string) {
    memory.add(url)
    await callShared(signal => shared?.add(url, { signal }))
  }

  /** Calls the shared index, reporting its failures, synchronous ones and timeouts included, instead of failing the operation. */
  async function callShared<T>(call: (signal: AbortSignal) => T | Promise<T>) {
    if (!shared) {
      return undefined
    }
    try {
      return await withTimeout(indexTimeout, call)
    } catch (error) {
      report(error)
      return undefined
    }
  }

  /** Passes an error to `onError` without waiting for it, so a failing or hanging callback cannot affect the operation. */
  function report(error: unknown) {
    try {
      // The callback is typed as synchronous, but an async one returns a promise whose rejection must not go unhandled.
      Promise.resolve(onError?.(error)).catch(() => {})
    } catch {
      // A throwing callback is ignored like a rejecting one.
    }
  }

  function storageCall<T>(
    reason: "source-error" | "storage-error",
    call: (signal: AbortSignal) => Promise<T>,
  ) {
    return withTimeout(storageTimeout, call).catch((error: unknown) => {
      throw error instanceof RenditionError
        ? error
        : new RenditionError(reason, `Storage call failed: ${error}`, { cause: error })
    })
  }

  async function render(recipe: Recipe, sourceKey: string, key: string) {
    const data = await storageCall("source-error", signal => source.read(sourceKey, { signal }))
    if (!data) {
      throw new RenditionError("source-not-found", `The source ${sourceKey} does not exist.`)
    }
    // Processing has no timeout: a processor cannot be interrupted, so a timeout would not free the processing slot.
    const image = await processor.process(data, recipe).catch((error: unknown) => {
      throw error instanceof RenditionError
        ? error
        : new RenditionError("processing-failed", `Processing failed: ${error}`, { cause: error })
    })
    await storageCall("storage-error", signal => results.write(key, image, { signal }))
  }

  return {
    async ensure(input, target, context) {
      // A frozen copy keeps the hash and the rendered recipe consistent if the caller or the processor mutates it.
      const recipe = Object.freeze({ ...input })
      const hash = hashRecipe(recipe)
      const { sourceKey, rendition } = await locate(hash, recipe.format, target, context)
      if (await isIndexed(rendition.url)) {
        return rendition
      }
      return coordinator.run(rendition.url, async () => {
        // A merged or previously locked run may have published the rendition meanwhile.
        if (!(await isIndexed(rendition.url))) {
          const exists = await storageCall("storage-error", signal =>
            results.exists(rendition.key, { signal }),
          )
          if (!exists) {
            await limiter.run(() => render(recipe, sourceKey, rendition.key))
          }
          await markPublished(rendition.url)
        }
        return rendition
      })
    },

    async findPublished(hash, format, target, context) {
      const { rendition } = await locate(hash, format, target, context)
      return (await isIndexed(rendition.url)) ? rendition : undefined
    },
  }
}

/**
 * Runs a call with an abort signal that fires after the timeout.
 *
 * The call may ignore the signal, so the timeout also settles the result, keeping a hung call from holding the request or a processing slot.
 */
function withTimeout<T>(
  timeout: number,
  call: (signal: AbortSignal) => T | Promise<T>,
): Promise<T> {
  const signal = AbortSignal.timeout(timeout)
  const expired = new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  })
  // The executor turns a synchronous throw into a rejection.
  return Promise.race([new Promise<T>(resolve => resolve(call(signal))), expired])
}

function resolveUnscoped({ scope, path }: RenditionTarget): SourceResolution | undefined {
  return scope === undefined ? { sourceKey: path } : undefined
}

function describe({ scope, path }: RenditionTarget) {
  return scope === undefined ? path : `${scope}:${path}`
}
