import { describe, expect, mock, test } from "bun:test"

import { defineCatalog } from "image-renditions"
import { createSSRApp, h } from "vue"
import { renderToString } from "vue/server-renderer"

mock.module("nuxt/app", () => ({ useRuntimeConfig: () => ({ app: { baseURL: "/base/" } }) }))
const { createRenditionHelpers } = await import("image-renditions/nuxt/runtime")

const catalog = defineCatalog({
  presets: {
    avatar: { width: 48, height: 48, densities: [1, 2], enlarge: true },
    badge: { width: 48, height: 48, fit: "contain" },
    thumb: { width: 48, height: 48 },
    content: { width: 1200 },
  },
})
const { useRenditions, RenditionImg } = createRenditionHelpers(catalog, { defaultScope: "t" })

function render(props: { preset: (typeof catalog.presets)[number]; src: string; scope?: string }) {
  return renderToString(createSSRApp({ render: () => h(RenditionImg, props) }))
}

describe("useRenditions", () => {
  test("builds URLs below the application base URL in the default scope", () => {
    const app = createSSRApp({})

    const url = app.runWithContext(() =>
      useRenditions().url("avatar", "uploads/1/a.jpg", { density: 2 }),
    )

    expect(url).toBe(`/base${catalog.url("avatar", { scope: "t", path: "uploads/1/a.jpg" }, 2)}`)
  })

  test("builds unscoped URLs without a default scope", () => {
    const unscoped = createRenditionHelpers(catalog)

    const url = createSSRApp({}).runWithContext(() =>
      unscoped.useRenditions().url("avatar", "uploads/1/a.jpg"),
    )

    expect(url).toBe(`/base${catalog.url("avatar", { path: "uploads/1/a.jpg" })}`)
  })

  test("lists every density in srcset", () => {
    const target = { scope: "t", path: "uploads/1/a.jpg" }

    const srcset = createSSRApp({}).runWithContext(() =>
      useRenditions().srcset("avatar", target.path),
    )

    expect(srcset).toBe(
      `/base${catalog.url("avatar", target)} 1x, /base${catalog.url("avatar", target, 2)} 2x`,
    )
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
    const target = { scope: "g", path: "uploads/1/a.jpg" }

    expect(await render({ preset: "avatar", src: target.path, scope: target.scope })).toBe(
      `<img src="/base${catalog.url("avatar", target)}" srcset="/base${catalog.url("avatar", target)} 1x, /base${catalog.url("avatar", target, 2)} 2x" width="48" height="48">`,
    )
    expect(await render({ preset: "badge", src: "uploads/1/a.jpg" })).toContain(
      'width="48" height="48"',
    )
  })

  test("omits the size of a preset whose output may keep the source size or aspect ratio", async () => {
    for (const preset of ["thumb", "content"] as const) {
      expect(await render({ preset, src: "uploads/1/a.jpg" })).toBe(
        `<img src="/base${catalog.url(preset, { scope: "t", path: "uploads/1/a.jpg" })}">`,
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
    presets: {
      logo: { width: 32, height: 32, enlarge: true, densities: [1, 2], originals: ["svg"] },
    },
  })

  function setup() {
    const calls = { composable: 0, builder: 0 }
    const helpers = createRenditionHelpers(logoCatalog, {
      defaultScope: "t",
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
      expect(renditions.url("logo", "brand/logo.svg")).toBe("https://uploads/t/brand/logo.svg")
      expect(renditions.url("logo", "brand/logo.svg", { scope: "g", density: 2 })).toBe(
        "https://uploads/g/brand/logo.svg",
      )
      expect(renditions.srcset("logo", "brand/logo.svg")).toBeUndefined()
      expect(renditions.url("logo", "brand/logo.png")).toBe(
        `/base${logoCatalog.url("logo", { scope: "t", path: "brand/logo.png" })}`,
      )
    })
  })

  test("renders only the src of the source itself", async () => {
    const { RenditionImg } = setup()

    const html = await renderToString(
      createSSRApp({ render: () => h(RenditionImg, { preset: "logo", src: "brand/logo.svg" }) }),
    )

    expect(html).toBe('<img src="https://uploads/t/brand/logo.svg">')
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
      expect(() => renditions.url("logo", "logo.svg", { scope: "a/b" })).toThrow(RangeError)
      expect(() => renditions.attrs("logo", "logo.svg", { scope: "a/b" })).toThrow(RangeError)
      expect(() => renditions.url("logo", "logo.svg", { density: 3 })).toThrow(RangeError)
    })

    expect(calls.builder).toBe(0)
  })

  test("requires useOriginalUrl when a preset lists originals", () => {
    expect(() => createRenditionHelpers(logoCatalog)).toThrow("useOriginalUrl")
  })
})
