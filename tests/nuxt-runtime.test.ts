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
const { useRenditions, RenditionImg } = createRenditionHelpers(catalog, "t")

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
