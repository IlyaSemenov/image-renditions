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
    /** Index shared between replicas, consulted after the memory index. */
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
  }
  /** Receives errors that do not fail the operation, such as an unavailable shared readiness index. */
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

/** Creates a rendition server over source and result stores. */
export function createRenditionServer<Context>(
  options: RenditionServerOptions<Context>,
): RenditionServer<Context> {
  const { source, results, processor, resolveSource = resolveUnscoped, onError } = options
  const memory = createMemoryReadinessIndex(options.readiness?.memory)
  const shared = options.readiness?.shared
  const coordinator = options.coordinator ?? createLocalCoordinator()
  const limiter = createLimiter({
    concurrency: options.limits?.concurrency ?? 2,
    queueSize: options.limits?.queueSize ?? 100,
    queueTimeout: options.limits?.queueTimeout ?? 30_000,
  })
  const storageTimeout = options.limits?.storageTimeout ?? 15_000
  const hashes = new WeakMap<Recipe, string>()

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
    const found = await callShared(() => shared?.has(url))
    if (found) {
      memory.add(url)
    }
    return found === true
  }

  async function markPublished(url: string) {
    memory.add(url)
    await callShared(() => shared?.add(url))
  }

  /** Calls the shared index, reporting its failures, synchronous ones included, instead of failing the operation. */
  async function callShared<T>(call: () => T | Promise<T>) {
    try {
      return await call()
    } catch (error) {
      onError?.(error)
      return undefined
    }
  }

  function storageCall<T>(
    reason: "source-error" | "storage-error",
    call: (signal: AbortSignal) => Promise<T>,
  ) {
    const signal = AbortSignal.timeout(storageTimeout)
    // A store may ignore the signal, so the timeout also settles the call, keeping a hung store from holding a processing slot.
    const timeout = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    })
    return Promise.race([call(signal), timeout]).catch((error: unknown) => {
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
    async ensure(recipe, target, context) {
      let hash = hashes.get(recipe)
      if (!hash) {
        hash = hashRecipe(recipe)
        hashes.set(recipe, hash)
      }
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

function resolveUnscoped({ scope, path }: RenditionTarget): SourceResolution | undefined {
  return scope === undefined ? { sourceKey: path } : undefined
}

function describe({ scope, path }: RenditionTarget) {
  return scope === undefined ? path : `${scope}:${path}`
}
