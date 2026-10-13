import { describe, expect, it } from "bun:test"

import { defineCatalog } from "./catalog"
import { parseRenditionPath } from "./url"

const target = { scope: "tenant", path: "uploads/1/photo.jpg" }

describe("recipe identity", () => {
  it("keeps hashes when a preset is renamed", () => {
    const before = defineCatalog({ presets: { avatar: { width: 64, height: 64 } } })
    const after = defineCatalog({ presets: { userpic: { width: 64, height: 64 } } })

    expect(after.variant("userpic").hash).toBe(before.variant("avatar").hash)
  })

  it("changes the hash when a preset parameter changes", () => {
    const base = defineCatalog({ presets: { avatar: { width: 64, height: 64 } } }).variant(
      "avatar",
    ).hash
    const changes = [
      { width: 65, height: 64 },
      { width: 64, height: 64, fit: "contain" as const },
      { width: 64, height: 64, position: "top" as const },
      { width: 64, height: 64, quality: 60 },
      { width: 64, height: 64, effort: 5 },
      { width: 64, height: 64, format: "webp" as const },
      { width: 64, height: 64, enlarge: true },
    ]

    const hashes = changes.map(
      avatar => defineCatalog({ presets: { avatar } }).variant("avatar").hash,
    )

    expect(new Set([base, ...hashes]).size).toBe(changes.length + 1)
  })

  it("changes every hash when the pipeline version changes", () => {
    const presets = { avatar: { width: 64 } }

    expect(defineCatalog({ pipelineVersion: 2, presets }).variant("avatar").hash).not.toBe(
      defineCatalog({ presets }).variant("avatar").hash,
    )
  })

  it("hashes explicit defaults and parameters that cannot affect the output like their absence", () => {
    const implicit = defineCatalog({
      presets: { cover: { width: 64, height: 64 }, wide: { width: 64 } },
    })
    const explicit = defineCatalog({
      defaults: { format: "avif", quality: 50, effort: 4, enlarge: false },
      presets: {
        cover: { width: 64, height: 64, fit: "cover", position: "center" },
        // A single dimension keeps the aspect ratio, so fit and position are irrelevant.
        wide: { width: 64, fit: "fill", position: "top" },
      },
    })

    expect(explicit.variant("cover").hash).toBe(implicit.variant("cover").hash)
    expect(explicit.variant("wide").hash).toBe(implicit.variant("wide").hash)
  })

  it("lets a preset override catalog defaults", () => {
    const catalog = defineCatalog({
      defaults: { format: "webp", densities: [1, 2] },
      presets: { inherited: { width: 64 }, own: { width: 64, format: "avif", densities: [1] } },
    })

    expect(catalog.variant("inherited", 2).recipe.format).toBe("webp")
    expect(catalog.variants("own").map(variant => variant.recipe.format)).toEqual(["avif"])
  })
})

describe("densities", () => {
  const catalog = defineCatalog({
    presets: { avatar: { width: 64, height: 48, densities: [2, 1] } },
  })

  it("renders each density as a separate recipe of scaled size", () => {
    const [single, double] = catalog.variants("avatar")

    expect(single!.recipe).toMatchObject({ width: 64, height: 48 })
    expect(double!.recipe).toMatchObject({ width: 128, height: 96 })
    expect(single!.hash).not.toBe(double!.hash)
  })

  it("lists every density in srcset", () => {
    expect(catalog.srcset("avatar", target)).toBe(
      `${catalog.url("avatar", target)} 1x, ${catalog.url("avatar", target, 2)} 2x`,
    )
  })

  it("rejects a density the preset does not declare", () => {
    expect(() => catalog.url("avatar", target, 3)).toThrow(RangeError)
  })
})

describe("urls", () => {
  const catalog = defineCatalog({ basePath: "/img", presets: { avatar: { width: 64 } } })

  it("round-trips the scope, variant and source path", () => {
    const path = "uploads/1/фото #1?.jpg"
    const variant = catalog.variant("avatar")

    expect(parseRenditionPath("/img", catalog.url("avatar", { scope: "global", path }))).toEqual({
      scope: "global",
      label: "avatar",
      hash: variant.hash,
      format: "avif",
      path,
    })
  })

  it("omits the scope of an unscoped path", () => {
    const url = catalog.url("avatar", { path: "uploads/1/photo.jpg" })

    expect(url).toBe(`/img/v1/avatar.${catalog.variant("avatar").hash}.avif/uploads/1/photo.jpg`)
    expect(parseRenditionPath("/img", url)).toEqual({
      label: "avatar",
      hash: catalog.variant("avatar").hash,
      format: "avif",
      path: "uploads/1/photo.jpg",
    })
  })

  it("round-trips control characters other than NUL", () => {
    const path = "uploads/1/photo\t2026.png"

    expect(parseRenditionPath("/img", catalog.url("avatar", { scope: "s", path }))?.path).toBe(path)
  })

  it("keeps equal paths of different scopes apart", () => {
    const tenant = parseRenditionPath(
      "/img",
      catalog.url("avatar", { scope: "tenant", path: target.path }),
    )
    const global = parseRenditionPath(
      "/img",
      catalog.url("avatar", { scope: "global", path: target.path }),
    )

    expect(tenant?.scope).toBe("tenant")
    expect(global?.scope).toBe("global")
  })

  it("rejects unsafe source paths when building", () => {
    for (const path of ["", "/a", "a/", "a//b", "a/../b", "./a", "a\\b", "a\u0000b", "a\uD800b"]) {
      expect(() => catalog.url("avatar", { scope: "s", path })).toThrow(RangeError)
    }
  })

  it("rejects unsafe or malformed urls when parsing", () => {
    const hash = catalog.variant("avatar").hash
    for (const url of [
      `/img/v1/s/avatar.${hash}.avif/a/../b`,
      `/img/v1/s/avatar.${hash}.avif/a/%2e%2e/b`,
      `/img/v1/s/avatar.${hash}.avif/a%2Fb`,
      `/img/v1/s/avatar.${hash}.avif/a//b`,
      `/img/v1/s/avatar.${hash}.avif/a%5Cb`,
      `/img/v1/s/avatar.${hash}.avif/%E0%A4%A`,
      `/img/v1/s/avatar.${hash}.avif/`,
      `/img/v1/s/avatar.${hash.slice(1)}.avif/a`,
      `/img/v1/s/avatar.${hash}/a`,
      `/img/v1/s/avatar.${hash}.gif/a`,
      `/img/v1/s/.${hash}.avif/a`,
      `/img/v1/s/avatar/a`,
      `/img/v1/s%20x/avatar.${hash}.avif/a`,
      `/img/v2/s/avatar.${hash}.avif/a`,
      `/other/v1/s/avatar.${hash}.avif/a`,
    ]) {
      expect(parseRenditionPath("/img", url)).toBeUndefined()
    }
  })

  it("ignores the query string", () => {
    const url = catalog.url("avatar", target)

    expect(parseRenditionPath("/img", `${url}?v=1`)?.path).toBe(target.path)
  })
})

describe("validation", () => {
  it("rejects invalid presets at definition time", () => {
    const invalid = [
      { width: 0 },
      { width: 1.5 },
      { width: 64, quality: 0 },
      { width: 64, effort: 10 },
      { width: 64, height: 64, fit: "contain" as const, position: "entropy" as const },
      { width: 64, background: "white" },
      { width: 64, densities: [] },
      { width: 64, densities: [1, 1] },
    ]
    for (const preset of invalid) {
      expect(() => defineCatalog({ presets: { preset } })).toThrow(RangeError)
    }
    expect(() => defineCatalog({ presets: { "a.b": { width: 64 } } })).toThrow(RangeError)
    expect(() => defineCatalog({ basePath: "/img/", presets: {} })).toThrow(RangeError)
  })
})
