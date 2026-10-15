import { assertInteger } from "../assert"
import type { Catalog, RenditionTarget } from "../catalog"
import { hashRecipe } from "../hash"
import { isSafePath } from "../path"
import { formatExtensions, type Recipe, type RenditionFormat } from "../recipe"
import { isDeclaredScope } from "../scopes"

import { type Coordinator, createLocalCoordinator } from "./coordinator"
import { RenditionError } from "./error"
import { createLimiter } from "./limiter"
import type { Degradation, Processor } from "./processor"
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
   * Key prefix of every rendition of the source in the result store; a rendition is stored at `<renditionPrefix>/<hash>.<extension>`.
   *
   * Defaults to `sourceKey`, which suits a result store separate from the source store, such as another bucket or the `prefix` folder of `createS3Results()`.
   * Different sources must have different prefixes, and in a store shared with sources the prefixes must stay apart from source keys, such as under `renditions/`.
   */
  renditionPrefix?: string
}

/**
 * Function of {@link RenditionServerOptions.resolveSource}, which maps a target to storage locations within the application context.
 *
 * It types a resolver defined apart from the server, such as in a module of its own.
 */
export type SourceResolver<Context, Scope extends string = string> = (
  target: RenditionTarget<Scope>,
  context: Context,
) => SourceResolution | undefined | Promise<SourceResolution | undefined>

/** Options of {@link createRenditionServer}. */
export interface RenditionServerOptions<Context, Scope extends string = string> {
  /** Catalog of the renditions the server serves, whose scopes type and limit its targets. */
  catalog: Catalog<string, Scope>
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
  // A function property rather than a method makes TypeScript reject a resolver of fewer scopes than the catalog declares, which alone gives the scopes.
  resolveSource?: SourceResolver<Context, NoInfer<Scope>>
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
  /**
   * Receives a degradation the processor reports for a rendition it rendered, such as the first frame of an animation beyond a limit, once the rendition is written.
   *
   * Later requests for the rendition do not report it again.
   * It is not awaited, and its own failures are ignored.
   */
  onDegradation?(degradation: RenditionDegradation<Context, Scope>): void
}

/** Degradation a processor reported for a rendition the server wrote. */
export interface RenditionDegradation<Context, Scope extends string = string> extends Degradation {
  recipe: Recipe
  target: RenditionTarget<Scope>
  /** Context of the call that rendered the rendition, which may be any of the concurrent calls for it. */
  context: Context
  rendition: Rendition
}

/** Published rendition. */
export interface Rendition {
  /** Key in the result store, which may keep it under a prefix of its own, such as the `prefix` of `createS3Results()`. */
  key: string
  /** Public URL. */
  url: string
}

/** Result of {@link RenditionServer.findPublished}. */
export interface PublishedLookup {
  /** Keys of the target. */
  source: Readonly<Required<SourceResolution>>
  /** Rendition the readiness indexes know, if any. */
  rendition?: Rendition
}

/** Generates renditions and finds published ones. */
// Function properties rather than methods make TypeScript check parameters strictly, so a server that needs a context cannot pass for one that does not.
export interface RenditionServer<Context, Scope extends string = string> {
  readonly catalog: Catalog<string, Scope>
  /**
   * Makes sure the rendition of a target is published and returns it.
   *
   * Resolves only after the rendition is written or confirmed to exist.
   *
   * @throws {RangeError} When the processor cannot render the recipe.
   * @throws {RenditionError} When the rendition cannot be published.
   */
  ensure: (recipe: Recipe, target: RenditionTarget<Scope>, context: Context) => Promise<Rendition>
  /**
   * Finds a rendition by recipe hash in the readiness indexes, without any storage call, and returns it with the keys of the target.
   *
   * Serves renditions of recipes the catalog no longer contains.
   *
   * @throws {RenditionError} When the target is rejected, with reason `invalid-request`.
   */
  findPublished: (
    hash: string,
    format: RenditionFormat,
    target: RenditionTarget<Scope>,
    context: Context,
  ) => Promise<PublishedLookup>
  /**
   * Storage locations of a target as `ensure()` uses them, with `renditionPrefix` defaulting to `sourceKey`.
   *
   * It checks that the catalog declares the scope, calls `resolveSource` and checks that the keys are safe, but does not check that the source exists.
   * Full rendition keys and the limits of a store are checked only when a rendition is located or stored.
   *
   * @throws {RenditionError} When the scope is not declared, or the target is rejected or resolves to an unsafe key, with reason `invalid-request`.
   */
  resolve: (
    target: RenditionTarget<Scope>,
    context: Context,
  ) => Promise<Readonly<Required<SourceResolution>>>
}

/** Longest delay of Node timers, in milliseconds. */
const MAX_TIMEOUT = 2 ** 31 - 1

/**
 * Creates a rendition server over source and result stores.
 *
 * @throws {RangeError} When a limit is not an integer in its range, or the processor cannot render a variant of the catalog.
 */
export function createRenditionServer<Context, Scope extends string = string>(
  options: RenditionServerOptions<Context, Scope>,
): RenditionServer<Context, Scope> {
  const {
    catalog,
    source,
    results,
    processor,
    resolveSource = resolveUnscoped,
    onError,
    onDegradation,
  } = options
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
  // A recipe the processor cannot render fails here rather than on every request for it.
  for (const variant of catalog.allVariants) {
    try {
      processor.assertRecipe?.(variant.recipe)
    } catch (error) {
      throw error instanceof RangeError
        ? new RangeError(`The processor cannot render "${variant.label}": ${error.message}`, {
            cause: error,
          })
        : error
    }
  }

  async function resolve(target: RenditionTarget<Scope>, context: Context) {
    // Requests are checked by the handler, but `ensure()` may get a target from anywhere.
    if (!isDeclaredScope(catalog.scopes, target.scope)) {
      throw new RenditionError(
        "invalid-request",
        `The scope of the target ${describe(target)} is not declared.`,
      )
    }
    const resolution = await resolveSource(target, context)
    if (!resolution) {
      throw new RenditionError("invalid-request", `The target ${describe(target)} is not served.`)
    }
    const { sourceKey } = resolution
    const renditionPrefix = resolution.renditionPrefix ?? sourceKey
    // Keys come from application code, so they are checked like client input to keep storage paths unambiguous.
    if (!isSafePath(sourceKey) || !isSafePath(renditionPrefix)) {
      throw createUnsafeKeyError(target)
    }
    // Frozen, as failures of every later step carry it.
    return Object.freeze({ sourceKey, renditionPrefix })
  }

  function locate(
    { renditionPrefix }: Required<SourceResolution>,
    hash: string,
    format: RenditionFormat,
    target: RenditionTarget<Scope>,
  ): Rendition {
    const key = `${renditionPrefix}/${hash}.${formatExtensions[format]}`
    // A safe prefix can still make the full key too long.
    if (!isSafePath(key)) {
      throw createUnsafeKeyError(target)
    }
    return { key, url: results.url(key) }
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
      notify(onError, error)
      return undefined
    }
  }

  function callStorage<T>(
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
    const input = await callStorage("source-error", signal => source.read(sourceKey, { signal }))
    if (!input) {
      throw new RenditionError("source-not-found", `The source ${sourceKey} does not exist.`)
    }
    // Processing has no timeout: a processor cannot be interrupted, so a timeout would not free the processing slot.
    const { data, contentType, degradation } = await processor
      .process(input, recipe)
      .catch((error: unknown) => {
        throw error instanceof RenditionError
          ? error
          : new RenditionError("processing-failed", `Processing failed: ${error}`, { cause: error })
      })
    // The store gets the fields by name, since a rest copy would skip fields a processor returns as getters.
    await callStorage("storage-error", signal =>
      results.write(key, { data, contentType }, { signal }),
    )
    return degradation
  }

  return {
    catalog,

    async ensure(input, target, context) {
      // A frozen copy keeps the hash and the rendered recipe consistent if the caller or the processor mutates it.
      const recipe = Object.freeze({ ...input })
      // Recipes of the catalog are checked at creation, but `ensure()` may get one from anywhere.
      processor.assertRecipe?.(recipe)
      const hash = hashRecipe(recipe)
      const source = await resolve(target, context)
      try {
        const rendition = locate(source, hash, recipe.format, target)
        if (await isIndexed(rendition.url)) {
          return rendition
        }
        // Awaited inside the try block, so the failures of a run merged with others get the keys of this call.
        return await coordinator.run(rendition.url, async () => {
          // A merged or previously locked run may have published the rendition meanwhile.
          if (!(await isIndexed(rendition.url))) {
            const exists = await callStorage("storage-error", signal =>
              results.exists(rendition.key, { signal }),
            )
            if (!exists) {
              const degradation = await limiter.run(() =>
                render(recipe, source.sourceKey, rendition.key),
              )
              if (degradation) {
                // A copy of the rendition keeps the callback from changing the result.
                notify(onDegradation, {
                  ...degradation,
                  recipe,
                  target,
                  context,
                  rendition: { ...rendition },
                })
              }
            }
            await markPublished(rendition.url)
          }
          return rendition
        })
      } catch (error) {
        throw attachSource(error, source)
      }
    },

    async findPublished(hash, format, target, context) {
      const source = await resolve(target, context)
      try {
        const rendition = locate(source, hash, format, target)
        return (await isIndexed(rendition.url)) ? { source, rendition } : { source }
      } catch (error) {
        throw attachSource(error, source)
      }
    },

    resolve,
  }
}

/**
 * Copies a rendition failure with the keys of its target, and passes other errors on.
 *
 * A new error is made because the caught one may be shared, by calls merged into one run or by a store or a processor that throws one instance.
 */
function attachSource(error: unknown, source: Readonly<Required<SourceResolution>>) {
  return error instanceof RenditionError
    ? new RenditionError(error.reason, error.message, { cause: error, source })
    : error
}

/** Calls an optional callback without waiting for it, so a failing or hanging callback cannot affect the operation. */
function notify<T>(callback: ((value: T) => void) | undefined, value: T) {
  try {
    // The callback is typed as synchronous, but an async one returns a promise whose rejection must not go unhandled.
    Promise.resolve(callback?.(value)).catch(() => {})
  } catch {
    // A throwing callback is ignored like a rejecting one.
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

function createUnsafeKeyError(target: RenditionTarget) {
  return new RenditionError(
    "invalid-request",
    `The target ${describe(target)} resolves to an unsafe key.`,
  )
}
