import { beforeEach, describe, expect, mock, test } from "bun:test"

import { defineCatalog } from "image-renditions"
import {
  createRenditionHandler,
  RenditionError,
  type RenditionFailure,
  type RenditionHandlerOptions,
} from "image-renditions/server"

import { catalog, createDeferred, createFakes, resolveSource, type TestContext } from "./fakes"

const tenant = { tenant: "acme" }
const target = { scope: "t", path: "uploads/1/photo.jpg" }

let fakes: ReturnType<typeof createFakes>

beforeEach(() => {
  fakes = createFakes()
  fakes.sources.set("tenant/acme/uploads/1/photo.jpg", new Uint8Array([1]))
})

function createHandler(options: Partial<RenditionHandlerOptions<TestContext>> = {}) {
  return createRenditionHandler<TestContext>({ server: fakes.createServer(), ...options })
}

function get(handler: ReturnType<typeof createHandler>, path: string) {
  return handler({ method: "GET", path }, () => tenant)
}

describe("published renditions", () => {
  test("redirects to the public URL with a moderate cache lifetime", async () => {
    const response = await get(createHandler(), catalog.url("avatar", target, 2))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      `https://cdn.test/tenant/acme/derived/uploads/1/photo.jpg/${catalog.variant("avatar", 2).hash}.avif`,
    )
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400")
  })

  test("keeps serving renditions of a recipe the catalog no longer contains", async () => {
    const published = new Set<string>()
    const readiness = {
      shared: {
        has: (url: string) => published.has(url),
        add: (url: string) => void published.add(url),
      },
    }
    const url = catalog.url("avatar", target)
    await get(createRenditionHandler({ server: fakes.createServer({ readiness }) }), url)
    const changed = defineCatalog({ presets: { avatar: { width: 65, height: 65 } } })
    const before = fakes.storageCalls()

    const response = await get(
      createRenditionHandler({ server: fakes.createServer({ catalog: changed, readiness }) }),
      url,
    )

    expect(response.status).toBe(307)
    expect(fakes.storageCalls()).toBe(before)
  })
})

describe("failures", () => {
  test("answers an unknown hash without storage calls", async () => {
    const hash = "0".repeat(12)

    const response = await get(
      createHandler(),
      `/_renditions/v1/t/avatar.${hash}.avif/${target.path}`,
    )

    expect(response.status).toBe(404)
    expect(await response.text()).toBe("unknown-recipe")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(fakes.storageCalls()).toBe(0)
  })

  test("answers a hash of another format as an unknown recipe of its target", async () => {
    const onFailure = mock(() => undefined)

    const response = await get(
      createHandler({ onFailure }),
      `/_renditions/v1/t/avatar.${"0".repeat(32)}.avif/${target.path}`,
    )

    expect(response.status).toBe(404)
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "unknown-recipe", target }),
    )
  })

  test("passes the keys of the target to the failure policy without resolving it again", async () => {
    const resolver = mock(resolveSource)
    const failures: RenditionFailure<TestContext>[] = []
    const handler = createRenditionHandler<TestContext>({
      server: fakes.createServer({ resolveSource: resolver }),
      onFailure: failure => void failures.push(failure),
    })

    await get(handler, `/_renditions/v1/t/avatar.${"0".repeat(12)}.avif/${target.path}`)
    await get(handler, "/_renditions/v1/malformed")

    expect(failures.map(({ reason, source }) => ({ reason, source }))).toEqual([
      {
        reason: "unknown-recipe",
        source: {
          sourceKey: "tenant/acme/uploads/1/photo.jpg",
          renditionPrefix: "tenant/acme/derived/uploads/1/photo.jpg",
        },
      },
      { reason: "invalid-request", source: undefined },
    ])
    expect(resolver).toHaveBeenCalledTimes(1)
  })

  test("lets the failure policy answer, without letting it be cached", async () => {
    const handler = createHandler({
      onFailure: ({ reason, address }) =>
        reason === "unknown-recipe"
          ? Response.redirect(`https://cdn.test/originals/${address!.path}`, 302)
          : undefined,
    })

    const response = await get(
      handler,
      `/_renditions/v1/t/avatar.${"0".repeat(12)}.avif/${target.path}`,
    )

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(`https://cdn.test/originals/${target.path}`)
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  test("does not redirect when writing fails", async () => {
    fakes.control.failWrites = true

    const response = await get(createHandler(), catalog.url("avatar", target))

    expect(response.status).toBe(502)
    expect(response.headers.get("location")).toBeNull()
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  test("answers a source over a size limit as unprocessable", async () => {
    const server = fakes.createServer({
      source: {
        read: () => Promise.reject(new RenditionError("source-too-large")),
      },
    })

    const response = await get(createHandler({ server }), catalog.url("avatar", target))

    expect(response.status).toBe(422)
    expect(await response.text()).toBe("source-too-large")
  })

  test("rejects malformed urls and urls whose extension contradicts the recipe", async () => {
    const handler = createHandler()
    const url = catalog.url("avatar", target)

    for (const path of [url.replace("/uploads/", "/../"), url.replace(".avif/", ".webp/")]) {
      const response = await get(handler, path)
      expect(response.status).toBe(404)
      expect(await response.text()).toBe("invalid-request")
    }
    expect(fakes.storageCalls()).toBe(0)
  })

  test("answers overload with a retryable status", async () => {
    const server = fakes.createServer({ limits: { concurrency: 1, queueSize: 0 } })
    const handler = createRenditionHandler({ server })
    const processing = createDeferred()
    fakes.control.processing = processing.promise
    fakes.sources.set("tenant/acme/uploads/2/other.jpg", new Uint8Array([2]))

    const running = get(handler, catalog.url("avatar", target))
    const response = await get(
      handler,
      catalog.url("avatar", { scope: "t", path: "uploads/2/other.jpg" }),
    )
    processing.resolve()

    expect(response.status).toBe(503)
    expect(response.headers.get("retry-after")).toBe("1")
    expect((await running).status).toBe(307)
  })

  test("allows only reading methods without resolving the context", async () => {
    const getContext = mock(() => tenant)

    const response = await createHandler()(
      { method: "POST", path: catalog.url("avatar", target) },
      getContext,
    )

    expect(response.status).toBe(405)
    expect(getContext).not.toHaveBeenCalled()
    expect(fakes.storageCalls()).toBe(0)
  })
})

describe("context", () => {
  const malformed = catalog.url("avatar", target).replace(".avif/", ".webp/")

  test("is not resolved for a malformed url without a failure policy", async () => {
    const getContext = mock(() => tenant)

    const response = await createHandler()({ method: "GET", path: malformed }, getContext)

    expect(response.status).toBe(404)
    expect(getContext).not.toHaveBeenCalled()
  })

  test("is resolved once for the failure policy of a malformed url", async () => {
    const getContext = mock(() => tenant)
    const onFailure = mock(() => undefined)

    await createHandler({ onFailure })({ method: "GET", path: malformed }, getContext)

    expect(getContext).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ context: tenant }))
  })

  test("propagates its failure without the failure policy", async () => {
    const failure = new RenditionError("invalid-request", "Unknown tenant.")
    const onFailure = mock(() => undefined)

    const response = createHandler({ onFailure })(
      { method: "GET", path: catalog.url("avatar", target) },
      () => Promise.reject(failure),
    )

    await expect(response).rejects.toBe(failure)
    expect(onFailure).not.toHaveBeenCalled()
  })
})

describe("catalog scopes", () => {
  const scopedCatalog = defineCatalog({
    scopes: ["t", "g"],
    presets: { avatar: { width: 64, height: 64 } },
  })
  const url = scopedCatalog.url("avatar", { scope: "t", path: target.path })

  function createScopedHandler() {
    const resolved: unknown[] = []
    const failures: RenditionFailure<TestContext, "t" | "g">[] = []
    const handler = createRenditionHandler({
      server: fakes.createServer({
        catalog: scopedCatalog,
        resolveSource(target, context) {
          resolved.push(target)
          return resolveSource(target, context)
        },
      }),
      onFailure(failure) {
        failures.push(failure)
        return undefined
      },
    })
    return { handler, resolved, failures }
  }

  test("serves urls of declared scopes", async () => {
    const { handler } = createScopedHandler()

    expect((await get(handler, url)).status).toBe(307)
  })

  test("rejects urls of other scopes or none before resolving their targets", async () => {
    const { handler, resolved, failures } = createScopedHandler()

    for (const path of [url.replace("/v1/t/", "/v1/x/"), url.replace("/v1/t/", "/v1/")]) {
      const response = await get(handler, path)
      expect(response.status).toBe(404)
      expect(await response.text()).toBe("invalid-request")
    }

    expect(resolved).toEqual([])
    expect(fakes.storageCalls()).toBe(0)
    expect(failures.map(({ address, target }) => [address?.path, target])).toEqual([
      [target.path, undefined],
      [target.path, undefined],
    ])
  })

  test("passes the target of a url with a declared scope to onFailure", async () => {
    const { handler, failures } = createScopedHandler()

    await get(handler, url.replace(".avif/", ".webp/"))

    expect(failures[0]?.target).toEqual({ scope: "t", path: target.path })
  })
})
