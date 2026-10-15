import { describe, expect, mock, test } from "bun:test"

import { defineCatalog, type ScopeName } from "image-renditions"
import { createSSRApp, h } from "vue"
import { renderToString } from "vue/server-renderer"

mock.module("nuxt/app", () => ({ useRuntimeConfig: () => ({ app: { baseURL: "/base/" } }) }))
const { createRenditionHelpers } = await import("image-renditions/nuxt/runtime")

const catalog = defineCatalog({
  scopes: ["tenant", "global"],
  presets: {
    avatar: { width: 48, height: 48, densities: [1, 2], enlarge: true },
    badge: { width: 48, height: 48, fit: "contain" },
    thumb: { width: 48, height: 48 },
    content: { width: 1200 },
    clip: { width: 48, height: 48, densities: [1, 2], enlarge: true, animation: "preserve" },
  },
})
const { useRenditions, RenditionImg } = createRenditionHelpers(catalog, { defaultScope: "tenant" })

function render(props: {
  preset: (typeof catalog.presets)[number]
  src: string
  scope?: ScopeName<typeof catalog>
}) {
  return renderToString(createSSRApp({ render: () => h(RenditionImg, props) }))
}

describe("useRenditions", () => {
  test("builds URLs below the application base URL in the default scope", () => {
    const app = createSSRApp({})

    const url = app.runWithContext(() =>
      useRenditions().url("avatar", "uploads/1/a.jpg", { density: 2 }),
    )

    expect(url).toBe(
      `/base${catalog.url("avatar", { scope: "tenant", path: "uploads/1/a.jpg" }, 2)}`,
    )
  })

  test("builds URLs without a scope for a catalog without scopes", () => {
    const unscopedCatalog = defineCatalog({ presets: { avatar: { width: 48 } } })
    const unscoped = createRenditionHelpers(unscopedCatalog)

    const url = createSSRApp({}).runWithContext(() =>
      unscoped.useRenditions().url("avatar", "uploads/1/a.jpg"),
    )

    expect(url).toBe(`/base${unscopedCatalog.url("avatar", { path: "uploads/1/a.jpg" })}`)
    expect(() => createRenditionHelpers(unscopedCatalog, { defaultScope: "tenant" })).toThrow(
      'Default rendition scope "tenant" in a catalog without scopes.',
    )
  })

  test("lists every density in srcset", () => {
    const target = { scope: "tenant", path: "uploads/1/a.jpg" } as const

    const srcset = createSSRApp({}).runWithContext(() =>
      useRenditions().srcset("avatar", target.path),
    )

    expect(srcset).toBe(
      `/base${catalog.url("avatar", target)} 1x, /base${catalog.url("avatar", target, 2)} 2x`,
    )
  })

  test("leaves the size out of the attributes on request, keeping the size of the element", async () => {
    const target = { scope: "tenant", path: "uploads/1/a.jpg" } as const
    const app = createSSRApp({
      render: () =>
        h("img", {
          width: 32,
          height: 32,
          ...useRenditions().attrs("avatar", target.path, { size: false }),
        }),
    })

    const attrs = app.runWithContext(() =>
      useRenditions().attrs("avatar", target.path, { size: false }),
    )

    expect(attrs).toStrictEqual({
      src: `/base${catalog.url("avatar", target)}`,
      srcset: `/base${catalog.url("avatar", target)} 1x, /base${catalog.url("avatar", target, 2)} 2x`,
    })
    expect(await renderToString(app)).toContain('width="32" height="32"')
  })

  test("builds nothing for an unsafe path", () => {
    createSSRApp({}).runWithContext(() => {
      const renditions = useRenditions()
      for (const path of ["uploads/1/..", "uploads/1/\uD800.jpg"]) {
        expect(renditions.url("avatar", path)).toBeUndefined()
        expect(renditions.srcset("avatar", path)).toBeUndefined()
      }
    })
  })
})

describe("RenditionImg", () => {
  test("renders every density and the size of a preset whose output always has the box size", async () => {
    const target = { scope: "global", path: "uploads/1/a.jpg" } as const

    expect(await render({ preset: "avatar", src: target.path, scope: target.scope })).toBe(
      `<img src="/base${catalog.url("avatar", target)}" srcset="/base${catalog.url("avatar", target)} 1x, /base${catalog.url("avatar", target, 2)} 2x" width="48" height="48">`,
    )
    expect(await render({ preset: "badge", src: "uploads/1/a.jpg" })).toContain(
      'width="48" height="48"',
    )
  })

  test("renders the animated variants of a GIF source of a preset that preserves animation", async () => {
    const target = { scope: "tenant", path: "uploads/1/a.gif" } as const
    const [single, double] = catalog.variants("clip", target.path)

    expect(await render({ preset: "clip", src: target.path })).toBe(
      `<img src="/base${catalog.url("clip", target)}" srcset="/base${catalog.url("clip", target)} 1x, /base${catalog.url("clip", target, 2)} 2x" width="48" height="48">`,
    )
    expect(catalog.url("clip", target)).toEndWith(`.${single!.hash}.webp`)
    expect(catalog.url("clip", target, 2)).toEndWith(`.${double!.hash}.webp`)
  })

  test("omits the size of a preset whose output may keep the source size or aspect ratio", async () => {
    for (const preset of ["thumb", "content"] as const) {
      expect(await render({ preset, src: "uploads/1/a.jpg" })).toBe(
        `<img src="/base${catalog.url(preset, { scope: "tenant", path: "uploads/1/a.jpg" })}">`,
      )
    }
  })

  test("shows sources that are already URLs unchanged", async () => {
    for (const src of [
      "blob:http://app/1",
      "data:image/png;base64,AA==",
      "https://example.com/a.png",
      "//cdn/a.png",
    ]) {
      expect(await render({ preset: "avatar", src })).toBe(`<img src="${src}">`)
    }
  })

  test("renders no source for an unsafe path", async () => {
    for (const src of ["uploads/1/..", "uploads/1/\uD800.jpg"]) {
      expect(await render({ preset: "avatar", src })).toBe("<img>")
    }
  })
})

describe("originals", () => {
  const logoCatalog = defineCatalog({
    scopes: ["tenant", "global"],
    presets: {
      logo: { width: 32, height: 32, enlarge: true, densities: [1, 2], originals: ["svg"] },
    },
  })

  function setup() {
    const calls = { composable: 0, builder: 0 }
    const helpers = createRenditionHelpers(logoCatalog, {
      defaultScope: "tenant",
      useOriginalUrl() {
        calls.composable++
        return ({ scope, path }) => {
          calls.builder++
          return `https://uploads/${scope}/${path}`
        }
      },
    })
    return { calls, ...helpers }
  }

  test("gives the URL of the source itself for every density and no srcset", () => {
    const { useRenditions } = setup()

    createSSRApp({}).runWithContext(() => {
      const renditions = useRenditions()
      expect(renditions.url("logo", "brand/logo.svg")).toBe("https://uploads/tenant/brand/logo.svg")
      expect(renditions.url("logo", "brand/logo.svg", { scope: "global", density: 2 })).toBe(
        "https://uploads/global/brand/logo.svg",
      )
      expect(renditions.srcset("logo", "brand/logo.svg")).toBeUndefined()
      expect(renditions.url("logo", "brand/logo.png")).toBe(
        `/base${logoCatalog.url("logo", { scope: "tenant", path: "brand/logo.png" })}`,
      )
    })
  })

  test("renders only the src of the source itself", async () => {
    const { RenditionImg } = setup()

    const html = await renderToString(
      createSSRApp({ render: () => h(RenditionImg, { preset: "logo", src: "brand/logo.svg" }) }),
    )

    expect(html).toBe('<img src="https://uploads/tenant/brand/logo.svg">')
  })

  test("calls the composable on every useRenditions()", () => {
    const { calls, useRenditions } = setup()

    createSSRApp({}).runWithContext(() => {
      useRenditions()
      useRenditions()
    })

    expect(calls.composable).toBe(2)
  })

  test("checks the path, the scope and the density before building the URL", () => {
    const { calls, useRenditions } = setup()

    createSSRApp({}).runWithContext(() => {
      const renditions = useRenditions()
      expect(renditions.url("logo", "brand/../logo.svg")).toBeUndefined()
      expect(renditions.attrs("logo", "brand/../logo.svg")).toEqual({})
      // @ts-expect-error The scope is not declared.
      expect(() => renditions.url("logo", "logo.svg", { scope: "a/b" })).toThrow(RangeError)
      // @ts-expect-error The scope is not declared.
      expect(() => renditions.attrs("logo", "logo.svg", { scope: "a/b" })).toThrow(RangeError)
      expect(() => renditions.url("logo", "logo.svg", { density: 3 })).toThrow(RangeError)
    })

    expect(calls.builder).toBe(0)
  })

  test("requires useOriginalUrl when a preset lists originals", () => {
    expect(() => createRenditionHelpers(logoCatalog)).toThrow("useOriginalUrl")
  })
})

describe("scopes", () => {
  const scopedCatalog = defineCatalog({
    scopes: ["tenant", "global"],
    presets: { avatar: { width: 48, height: 48 }, logo: { height: 32, originals: ["svg"] } },
  })

  test("rejects a default scope the catalog does not declare", () => {
    expect(() =>
      createRenditionHelpers(scopedCatalog, {
        // @ts-expect-error The default scope is not declared.
        defaultScope: "other",
        useOriginalUrl: () => () => "",
      }),
    ).toThrow(RangeError)
  })

  test("requires a declared scope in every call, for originals too", () => {
    let built = 0
    const { useRenditions } = createRenditionHelpers(scopedCatalog, {
      useOriginalUrl: () => () => `https://uploads/${built++}`,
    })

    createSSRApp({}).runWithContext(() => {
      const renditions = useRenditions()
      expect(renditions.url("avatar", "a.jpg", { scope: "global" })).toBe(
        `/base${scopedCatalog.url("avatar", { scope: "global", path: "a.jpg" })}`,
      )
      expect(() => renditions.url("avatar", "a.jpg")).toThrow(RangeError)
      expect(() => renditions.attrs("logo", "a.svg")).toThrow(RangeError)
      // @ts-expect-error The scope is not declared.
      expect(() => renditions.url("logo", "a.svg", { scope: "other" })).toThrow(RangeError)
    })

    expect(built).toBe(0)
  })
})

describe("default attributes", () => {
  const imgCatalog = defineCatalog({
    presets: {
      thumb: { width: 48, height: 48, densities: [1, 2] },
      logo: { height: 32, originals: ["svg"] },
    },
  })
  const useOriginalUrl =
    () =>
    ({ path }: { path: string }) =>
      `https://uploads/${path}`

  function renderImg(
    RenditionImg: ReturnType<typeof createRenditionHelpers<"thumb" | "logo">>["RenditionImg"],
    props: { preset: "thumb" | "logo"; src: string; loading?: string },
  ) {
    return renderToString(createSSRApp({ render: () => h(RenditionImg, props) }))
  }

  test("renders them unless the element overrides them", async () => {
    const { RenditionImg } = createRenditionHelpers(imgCatalog, {
      useOriginalUrl,
      imgAttrs: { loading: "lazy", decoding: "async" },
    })
    const src = `/base${imgCatalog.url("thumb", { path: "a.jpg" })}`

    expect(await renderImg(RenditionImg, { preset: "thumb", src: "a.jpg" })).toStartWith(
      `<img loading="lazy" decoding="async" src="${src}"`,
    )
    expect(
      await renderImg(RenditionImg, { preset: "thumb", src: "a.jpg", loading: "eager" }),
    ).toStartWith(`<img loading="eager" decoding="async" src="${src}"`)
  })

  test("cannot set a rendition attribute in any letter case", () => {
    expect(() =>
      // @ts-expect-error The rendition alone sets its source and size.
      createRenditionHelpers(imgCatalog, { useOriginalUrl, imgAttrs: { srcset: "x.png 2x" } }),
    ).toThrow(RangeError)
    for (const name of ["srcSet", "WIDTH", "Height", "SRC"]) {
      expect(() =>
        createRenditionHelpers(imgCatalog, { useOriginalUrl, imgAttrs: { [name]: "1" } }),
      ).toThrow(RangeError)
    }
  })
})
