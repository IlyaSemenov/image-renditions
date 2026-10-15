import { beforeEach, describe, expect, mock, test } from "bun:test"

import { defineCatalog, type Recipe } from "image-renditions"
import { type Processor, type RenditionDegradation, RenditionError } from "image-renditions/server"

import { catalog, createDeferred, createFakes, type TestContext } from "./fakes"

const tenant = { tenant: "acme" }
const target = { scope: "t", path: "uploads/1/photo.jpg" }
const avatar = catalog.variant("avatar").recipe

let fakes: ReturnType<typeof createFakes>

beforeEach(() => {
  fakes = createFakes()
  fakes.sources.set("tenant/acme/uploads/1/photo.jpg", new Uint8Array([1]))
  fakes.sources.set("uploads/1/photo.jpg", new Uint8Array([2]))
})

describe("ensure", () => {
  test("publishes a rendition under the source's rendition prefix", async () => {
    const server = fakes.createServer()

    const rendition = await server.ensure(avatar, target, tenant)

    const key = `tenant/acme/derived/uploads/1/photo.jpg/${catalog.variant("avatar").hash}.avif`
    expect(rendition).toEqual({ key, url: `https://cdn.test/${key}` })
    expect(fakes.results.get(key)?.contentType).toBe("image/avif")
  })

  test("renders the recipe as passed even if the caller changes it meanwhile", async () => {
    let rendered: Recipe | undefined
    const server = fakes.createServer({
      processor: {
        async process(source, recipe) {
          rendered = recipe
          return { data: source, contentType: "image/avif" }
        },
      },
    })
    const recipe = { ...avatar }

    const ensured = server.ensure(recipe, target, tenant)
    recipe.width = 100
    const rendition = await ensured

    expect(rendition.key).toEndWith(`/${catalog.variant("avatar").hash}.avif`)
    expect(rendered?.width).toBe(avatar.width)
    expect(Object.isFrozen(rendered)).toBe(true)
  })

  test("serves a known rendition from the readiness index without storage calls", async () => {
    const server = fakes.createServer()
    await server.ensure(avatar, target, tenant)
    const before = fakes.storageCalls()

    await server.ensure(avatar, target, tenant)

    expect(fakes.storageCalls()).toBe(before)
  })

  test("confirms a stored rendition with one existence check and no processing", async () => {
    await fakes.createServer().ensure(avatar, target, tenant)
    const restarted = fakes.createServer()
    fakes.calls.read = fakes.calls.exists = fakes.calls.write = fakes.calls.process = 0

    await restarted.ensure(avatar, target, tenant)

    expect(fakes.calls).toEqual({ read: 0, exists: 1, write: 0, process: 0 })
  })

  test("does not mark a rendition published when writing fails", async () => {
    const server = fakes.createServer()
    fakes.control.failWrites = true

    const failure = await server.ensure(avatar, target, tenant).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(RenditionError)
    expect((failure as RenditionError).reason).toBe("storage-error")
    expect(
      (await server.findPublished(catalog.variant("avatar").hash, "avif", target, tenant))
        .rendition,
    ).toBeUndefined()

    fakes.control.failWrites = false
    await server.ensure(avatar, target, tenant)
    expect(fakes.calls.process).toBe(2)
  })

  test("processes concurrent equal requests once", async () => {
    const server = fakes.createServer()

    const renditions = await Promise.all(
      Array.from({ length: 5 }, () => server.ensure(avatar, target, tenant)),
    )

    expect(new Set(renditions.map(rendition => rendition.url)).size).toBe(1)
    expect(fakes.calls.process).toBe(1)
    expect(fakes.calls.write).toBe(1)
  })

  test("keeps equal paths of different scopes apart", async () => {
    const server = fakes.createServer()

    const scoped = await server.ensure(avatar, target, tenant)
    const global = await server.ensure(avatar, { ...target, scope: "g" }, tenant)

    expect(scoped.key).not.toBe(global.key)
    expect(fakes.results.get(scoped.key)?.data).toEqual(new Uint8Array([1]))
    expect(fakes.results.get(global.key)?.data).toEqual(new Uint8Array([2]))
  })

  test("reports a missing source without publishing", async () => {
    const server = fakes.createServer()

    const failure = await server
      .ensure(avatar, { scope: "t", path: "uploads/2/missing.jpg" }, tenant)
      .catch((error: unknown) => error)

    expect((failure as RenditionError).reason).toBe("source-not-found")
    expect((failure as RenditionError).source).toEqual({
      sourceKey: "tenant/acme/uploads/2/missing.jpg",
      renditionPrefix: "tenant/acme/derived/uploads/2/missing.jpg",
    })
    expect(fakes.calls.write).toBe(0)
  })

  test("gives each call the keys of its own target, even when a failure is shared", async () => {
    // A processor may throw one instance for every call, and merged calls share one failure.
    const shared = new RenditionError("unsupported-source")
    const server = fakes.createServer({
      processor: {
        async process() {
          throw shared
        },
      },
    })
    const other = { scope: "g", path: "uploads/1/photo.jpg" }

    const failures = await Promise.all(
      [target, target, other].map(item =>
        server.ensure(avatar, item, tenant).then(
          () => expect.unreachable(),
          (error: unknown) => error as RenditionError,
        ),
      ),
    )

    expect(failures.map(failure => failure.source?.sourceKey)).toEqual([
      "tenant/acme/uploads/1/photo.jpg",
      "tenant/acme/uploads/1/photo.jpg",
      "uploads/1/photo.jpg",
    ])
    expect(failures.map(failure => failure.reason)).toEqual(Array(3).fill("unsupported-source"))
    expect(failures.every(failure => failure !== shared && failure.cause === shared)).toBe(true)
  })

  test("rejects targets the resolver does not serve and unsafe resolved keys", async () => {
    const unknownScope = await fakes
      .createServer()
      .ensure(avatar, { scope: "x", path: target.path }, tenant)
      .catch((error: unknown) => error)
    const unsafeKey = await fakes
      .createServer({
        resolveSource: () => ({ sourceKey: "a/../b", renditionPrefix: "derived/a" }),
      })
      .ensure(avatar, target, tenant)
      .catch((error: unknown) => error)

    expect((unknownScope as RenditionError).reason).toBe("invalid-request")
    expect((unsafeKey as RenditionError).reason).toBe("invalid-request")
    // The keys are attached only once the resolver accepts them.
    expect((unknownScope as RenditionError).source).toBeUndefined()
    expect((unsafeKey as RenditionError).source).toBeUndefined()
    expect(fakes.storageCalls()).toBe(0)
  })
})

describe("default source resolution", () => {
  test("serves an unscoped path from the same key and stores renditions under it", async () => {
    const server = fakes.createServer({ resolveSource: undefined })

    const rendition = await server.ensure(avatar, { path: "uploads/1/photo.jpg" }, tenant)
    const scoped = await server.ensure(avatar, target, tenant).catch((error: unknown) => error)

    expect(rendition.key).toBe(`uploads/1/photo.jpg/${catalog.variant("avatar").hash}.avif`)
    expect(fakes.results.get(rendition.key)?.data).toEqual(new Uint8Array([2]))
    expect((scoped as RenditionError).reason).toBe("invalid-request")
  })
})

describe("shared readiness index", () => {
  test("falls back to the store when the shared index fails, reporting each failure", async () => {
    for (const failure of [
      () => {
        throw new Error("Index unavailable.")
      },
      () => Promise.reject(new Error("Index unavailable.")),
    ]) {
      let calls = 0
      const fail = () => {
        calls++
        return failure()
      }
      const errors: unknown[] = []
      const server = fakes.createServer({
        readiness: { shared: { has: fail, add: fail } },
        onError: error => errors.push(error),
      })

      expect(await server.ensure(avatar, target, tenant)).toHaveProperty("url")
      expect(calls).toBeGreaterThan(0)
      expect(errors).toHaveLength(calls)
    }
  })

  describe("that does not answer", () => {
    const hang = () => new Promise<never>(() => {})

    test("falls back to the store after the index timeout", async () => {
      const errors: unknown[] = []
      const server = fakes.createServer({
        readiness: { shared: { has: hang, add: hang } },
        limits: { indexTimeout: 10 },
        onError: error => errors.push(error),
      })

      expect(await server.ensure(avatar, target, tenant)).toHaveProperty("url")
      expect(fakes.calls.exists).toBe(1)
      expect(errors.length).toBeGreaterThan(0)
    })

    test("finds no outdated rendition, without storage calls", async () => {
      const errors: unknown[] = []
      const server = fakes.createServer({
        readiness: { shared: { has: hang, add: hang } },
        limits: { indexTimeout: 10 },
        onError: error => errors.push(error),
      })

      expect(
        (await server.findPublished(catalog.variant("avatar").hash, "avif", target, tenant))
          .rendition,
      ).toBeUndefined()
      expect(fakes.storageCalls()).toBe(0)
      expect(errors).toHaveLength(1)
    })
  })

  test("ignores an error callback that throws, rejects or hangs", async () => {
    for (const onError of [
      () => {
        throw new Error("Reporter failed.")
      },
      () => Promise.reject(new Error("Reporter failed.")),
      () => new Promise<never>(() => {}),
    ]) {
      const fail = () => Promise.reject(new Error("Index unavailable."))
      const server = fakes.createServer({
        readiness: { shared: { has: fail, add: fail } },
        onError,
      })

      expect(await server.ensure(avatar, target, tenant)).toHaveProperty("url")
    }
  })
})

describe("findPublished", () => {
  test("finds a rendition only through the readiness index", async () => {
    const server = fakes.createServer()
    const { hash } = catalog.variant("avatar")

    const source = await server.resolve(target, tenant)

    expect(await server.findPublished(hash, "avif", target, tenant)).toEqual({ source })
    const rendition = await server.ensure(avatar, target, tenant)
    const before = fakes.storageCalls()

    expect(await server.findPublished(hash, "avif", target, tenant)).toEqual({ source, rendition })
    expect(fakes.storageCalls()).toBe(before)
  })
})

describe("resolve", () => {
  test("returns the keys of a target without storage calls", async () => {
    const server = fakes.createServer()

    expect(await server.resolve(target, tenant)).toEqual({
      sourceKey: "tenant/acme/uploads/1/photo.jpg",
      renditionPrefix: "tenant/acme/derived/uploads/1/photo.jpg",
    })
    expect(fakes.storageCalls()).toBe(0)
  })

  test("defaults the rendition prefix to the source key", async () => {
    const server = fakes.createServer({ resolveSource: undefined })

    expect(await server.resolve({ path: "uploads/1/photo.jpg" }, tenant)).toEqual({
      sourceKey: "uploads/1/photo.jpg",
      renditionPrefix: "uploads/1/photo.jpg",
    })
  })

  test("rejects a scope the catalog does not declare without calling the resolver", async () => {
    let resolved = 0
    const server = fakes.createServer({
      catalog: defineCatalog({ scopes: ["t"], presets: { avatar: { width: 64 } } }),
      resolveSource: () => {
        resolved++
        return { sourceKey: target.path }
      },
    })

    const failure = await server
      // @ts-expect-error The scope is not declared.
      .resolve({ scope: "g", path: target.path }, tenant)
      .catch((error: unknown) => error)

    expect((failure as RenditionError).reason).toBe("invalid-request")
    expect(resolved).toBe(0)
  })

  test("rejects targets the resolver does not serve and unsafe resolved keys", async () => {
    const resolutions = [
      undefined,
      { sourceKey: "a/../b" },
      { sourceKey: "uploads/1/photo.jpg", renditionPrefix: "derived/" },
    ]
    for (const resolution of resolutions) {
      const error = await fakes
        .createServer({ resolveSource: () => resolution })
        .resolve(target, tenant)
        .catch((error: unknown) => error)

      expect((error as RenditionError).reason).toBe("invalid-request")
    }
  })
})

describe("processor", () => {
  test("checks every variant of the catalog at creation, animated ones included", () => {
    const animated = defineCatalog({ presets: { clip: { width: 64, animation: "preserve" } } })
    const checked: Recipe[] = []
    async function process(source: Uint8Array) {
      return { data: source, contentType: "image/webp" }
    }

    fakes.createServer({
      catalog: animated,
      processor: { process, assertRecipe: recipe => void checked.push(recipe) },
    })

    expect(checked).toEqual(animated.allVariants.map(variant => variant.recipe))
    expect(checked.map(recipe => recipe.animation)).toEqual(["first-frame", "preserve"])
    expect(() =>
      fakes.createServer({
        catalog: animated,
        processor: {
          process,
          assertRecipe(recipe) {
            if (recipe.animation === "preserve") {
              throw new RangeError("No animations.")
            }
          },
        },
      }),
    ).toThrow('The processor cannot render "clip": No animations.')
  })

  test("checks a recipe passed to ensure", async () => {
    const server = fakes.createServer({
      processor: {
        async process(source) {
          return { data: source, contentType: "image/avif" }
        },
        assertRecipe(recipe) {
          if (recipe.width === 100) {
            throw new RangeError("Too wide.")
          }
        },
      },
    })

    await expect(server.ensure({ ...avatar, width: 100 }, target, tenant)).rejects.toThrow(
      RangeError,
    )
    expect(fakes.storageCalls()).toBe(0)
  })
})

describe("degradation", () => {
  const degradation = { reason: "animation-frames", message: "Too many frames." }
  const processor: Processor = {
    async process(source) {
      return { data: source, contentType: "image/avif", degradation }
    },
  }

  test("is reported once, when the rendition is written", async () => {
    const reported: RenditionDegradation<TestContext>[] = []
    const onDegradation = (event: RenditionDegradation<TestContext>) => void reported.push(event)
    const server = fakes.createServer({ processor, onDegradation })

    const [rendition] = await Promise.all(
      Array.from({ length: 3 }, () => server.ensure(avatar, target, tenant)),
    )
    await server.ensure(avatar, target, tenant)
    await fakes.createServer({ processor, onDegradation }).ensure(avatar, target, tenant)

    expect(reported).toEqual([
      { ...degradation, recipe: avatar, target, context: tenant, rendition: rendition! },
    ])
    expect(reported[0]!.rendition).not.toBe(rendition)
    expect(fakes.results.get(rendition!.key)).toEqual({
      data: new Uint8Array([1]),
      contentType: "image/avif",
    })
  })

  test("is not reported when writing fails", async () => {
    const reported: RenditionDegradation<TestContext>[] = []
    const server = fakes.createServer({
      processor,
      onDegradation: event => void reported.push(event),
    })
    fakes.control.failWrites = true

    await expect(server.ensure(avatar, target, tenant)).rejects.toThrow(RenditionError)
    expect(reported).toEqual([])
  })

  test("ignores a callback that throws, rejects or hangs", async () => {
    for (const callback of [
      () => {
        throw new Error("Reporter failed.")
      },
      () => Promise.reject(new Error("Reporter failed.")),
      () => new Promise<never>(() => {}),
    ]) {
      // A stored rendition is not rendered again, so every callback gets a fresh store.
      fakes.results.clear()
      const onDegradation = mock(callback)
      const server = fakes.createServer({ processor, onDegradation })

      expect(await server.ensure(avatar, target, tenant)).toHaveProperty("url")
      expect(onDegradation).toHaveBeenCalledTimes(1)
    }
  })
})

describe("limits", () => {
  const paths = ["uploads/1/a.jpg", "uploads/1/b.jpg", "uploads/1/c.jpg"]

  beforeEach(() => {
    for (const path of paths) {
      fakes.sources.set(`tenant/acme/${path}`, new Uint8Array([3]))
    }
  })

  test("rejects requests beyond the queue as overloaded", async () => {
    const server = fakes.createServer({ limits: { concurrency: 1, queueSize: 1 } })
    const processing = createDeferred()
    fakes.control.processing = processing.promise

    const [running, queued, rejected] = paths.map(path =>
      server.ensure(avatar, { scope: "t", path }, tenant).catch((error: unknown) => error),
    )

    expect(((await rejected) as RenditionError).reason).toBe("overloaded")
    processing.resolve()
    expect(await running).toHaveProperty("url")
    expect(await queued).toHaveProperty("url")
  })

  test.each([
    { concurrency: 0 },
    { queueSize: -1 },
    { queueTimeout: 0.5 },
    { storageTimeout: 2 ** 31 },
    { indexTimeout: Number.NaN },
  ])("rejects %p", limits => {
    expect(() => fakes.createServer({ limits })).toThrow(RangeError)
  })

  test("fails a storage call that ignores its abort signal after the timeout", async () => {
    const server = fakes.createServer({
      results: { exists: () => new Promise(() => {}), write: async () => {}, url: key => key },
      limits: { storageTimeout: 10 },
    })

    const failure = await server.ensure(avatar, target, tenant).catch((error: unknown) => error)

    expect((failure as RenditionError).reason).toBe("storage-error")
  })

  test("rejects requests waiting for a slot too long as overloaded", async () => {
    const server = fakes.createServer({ limits: { concurrency: 1, queueTimeout: 10 } })
    const processing = createDeferred()
    fakes.control.processing = processing.promise

    const running = server.ensure(avatar, { scope: "t", path: paths[0]! }, tenant)
    const waiting = await server
      .ensure(avatar, { scope: "t", path: paths[1]! }, tenant)
      .catch((error: unknown) => error)

    expect((waiting as RenditionError).reason).toBe("overloaded")
    processing.resolve()
    expect(await running).toHaveProperty("url")
  })
})
