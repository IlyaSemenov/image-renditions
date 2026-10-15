import { defineCatalog, type RenditionTarget } from "image-renditions"
import {
  createRenditionServer,
  type EncodedImage,
  type Processor,
  type RenditionServerOptions,
  type SourceResolution,
} from "image-renditions/server"

/** Context of the test application: the tenant of a request or a job. */
export interface TestContext {
  tenant: string
}

export const catalog = defineCatalog({
  presets: {
    avatar: { width: 64, height: 64, densities: [1, 2] },
    cover: { width: 800, height: 200 },
  },
})

/** Maps the `t` scope to the context tenant and the `g` scope to global storage. */
export function resolveSource(
  { scope, path }: RenditionTarget,
  { tenant }: TestContext,
): SourceResolution | undefined {
  const prefix = scope === "t" ? `tenant/${tenant}/` : scope === "g" ? "" : undefined
  return prefix === undefined
    ? undefined
    : { sourceKey: `${prefix}${path}`, renditionPrefix: `${prefix}derived/${path}` }
}

/** Creates in-memory stores and a processor that count their calls. */
export function createFakes() {
  const sources = new Map<string, Uint8Array>()
  const results = new Map<string, EncodedImage>()
  const calls = { read: 0, exists: 0, write: 0, process: 0 }
  const control = { failWrites: false, processing: undefined as Promise<void> | undefined }

  const processor: Processor = {
    async process(source) {
      calls.process++
      await control.processing
      return { data: source, contentType: "image/avif" }
    },
  }

  const options = {
    catalog,
    source: {
      async read(key) {
        calls.read++
        return sources.get(key)
      },
    },
    results: {
      async exists(key) {
        calls.exists++
        return results.has(key)
      },
      async write(key, image) {
        calls.write++
        if (control.failWrites) {
          throw new Error("Write failed.")
        }
        results.set(key, image)
      },
      url: key => `https://cdn.test/${encodeURI(key)}`,
    },
    processor,
    resolveSource,
  } satisfies RenditionServerOptions<TestContext>

  function createServer<Scope extends string = string>(
    overrides: Partial<RenditionServerOptions<TestContext, Scope>> = {},
  ) {
    // The default catalog declares no scopes, so it serves as a catalog of any.
    return createRenditionServer<TestContext, Scope>({
      ...(options as unknown as RenditionServerOptions<TestContext, Scope>),
      ...overrides,
    })
  }

  function storageCalls() {
    return calls.read + calls.exists + calls.write
  }

  return { sources, results, calls, control, createServer, storageCalls }
}

/** Promise resolved from outside, for holding a task until a test releases it. */
export function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}
