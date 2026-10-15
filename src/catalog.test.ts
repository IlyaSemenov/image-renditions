import { describe, expect, it } from "bun:test"

import { defineCatalog } from "./catalog"
import { parseRenditionPath } from "./url"

const target = { path: "uploads/1/photo.jpg" }

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

  it("rejects different recipes of the same hash", () => {
    // A search over sizes found these two recipes, whose truncated hashes collide.
    const presets = { a: { width: 9230, height: 168 }, b: { width: 10785, height: 202 } }

    expect(() => defineCatalog({ presets })).toThrow(RangeError)
    expect(defineCatalog({ presets: { a: presets.a } }).variant("a").hash).toBe(
      defineCatalog({ presets: { b: presets.b } }).variant("b").hash,
    )
  })

  it("freezes the catalog, its variants and their recipes", () => {
    const catalog = defineCatalog({ presets: { avatar: { width: 64, densities: [1, 2] } } })
    const variants = catalog.variants("avatar")

    expect(Object.isFrozen(catalog)).toBe(true)
    expect(Object.isFrozen(catalog.presets)).toBe(true)
    expect(Object.isFrozen(variants)).toBe(true)
    expect(variants.every(variant => Object.isFrozen(variant))).toBe(true)
    expect(variants.every(variant => Object.isFrozen(variant.recipe))).toBe(true)
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
  const catalog = defineCatalog({
    basePath: "/img",
    scopes: ["tenant", "global", "s"],
    presets: { avatar: { width: 64 } },
  })
  const unscoped = defineCatalog({ basePath: "/img", presets: { avatar: { width: 64 } } })

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

  it("omits the scope in a catalog without scopes", () => {
    const url = unscoped.url("avatar", { path: "uploads/1/photo.jpg" })

    expect(url).toBe(`/img/v1/avatar.${unscoped.variant("avatar").hash}.avif/uploads/1/photo.jpg`)
    expect(parseRenditionPath("/img", url)).toEqual({
      label: "avatar",
      hash: unscoped.variant("avatar").hash,
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
      `/img/v1/s/avatar.${"0".repeat(65)}.avif/a`,
      `/img/v1/s/avatar.a%41.avif/a`,
      `/img/v1/s/avatar.a~b.avif/a`,
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

  it("parses hashes of other formats", () => {
    for (const hash of ["0", "0".repeat(32), "0".repeat(64), "Ab_9-"]) {
      expect(parseRenditionPath("/img", `/img/v1/avatar.${hash}.avif/a`)?.hash).toBe(hash)
    }
  })

  it("ignores the query string", () => {
    const url = unscoped.url("avatar", target)

    expect(parseRenditionPath("/img", `${url}?v=1`)?.path).toBe(target.path)
  })
})

describe("scopes", () => {
  const catalog = defineCatalog({
    scopes: ["tenant", "global"],
    presets: { avatar: { width: 64, densities: [1, 2] } },
  })

  it("builds urls of declared scopes", () => {
    const url = catalog.url("avatar", { scope: "global", path: "a.jpg" })

    expect(parseRenditionPath(catalog.basePath, url)?.scope).toBe("global")
  })

  it("rejects targets without a declared scope", () => {
    // @ts-expect-error A catalog with scopes requires one in every target.
    expect(() => catalog.url("avatar", { path: "a.jpg" })).toThrow(RangeError)
    // @ts-expect-error The scope is not declared.
    expect(() => catalog.srcset("avatar", { scope: "other", path: "a.jpg" })).toThrow(RangeError)
  })

  it("rejects a scope in a catalog without scopes", () => {
    const unscoped = defineCatalog({ presets: { avatar: { width: 64 } } })

    expect(() => unscoped.url("avatar", { scope: "global", path: "a.jpg" })).toThrow(
      'Rendition scope "global" in a catalog without scopes.',
    )
  })
})

describe("originals", () => {
  it("inherits originals from defaults unless a preset overrides them", () => {
    const catalog = defineCatalog({
      defaults: { originals: ["svg", "ico"] },
      presets: { logo: { height: 32 }, "email-logo": { height: 32, originals: [] } },
    })

    expect(catalog.originals("logo")).toEqual(["svg", "ico"])
    expect(catalog.originals("email-logo")).toEqual([])
  })

  it("matches the extension of the last path segment in any case", () => {
    const catalog = defineCatalog({ presets: { logo: { height: 32, originals: ["svg"] } } })

    expect(catalog.isOriginal("logo", "brand/logo.SVG")).toBe(true)
    expect(catalog.isOriginal("logo", "logo.svg/photo.png")).toBe(false)
    expect(catalog.isOriginal("logo", "brand.svg/logo")).toBe(false)
    expect(catalog.isOriginal("logo", "brand/svg")).toBe(false)
  })

  it("keeps hashes when originals change", () => {
    const before = defineCatalog({ presets: { logo: { height: 32 } } })
    const after = defineCatalog({ presets: { logo: { height: 32, originals: ["svg"] } } })

    expect(after.variant("logo").hash).toBe(before.variant("logo").hash)
  })

  it("keeps its own copy of the list", () => {
    const originals = ["svg"]
    const catalog = defineCatalog({ presets: { logo: { height: 32, originals } } })

    originals.push("png")

    expect(catalog.originals("logo")).toEqual(["svg"])
    expect(Object.isFrozen(catalog.originals("logo"))).toBe(true)
  })
})

describe("animation", () => {
  const catalog = defineCatalog({
    presets: {
      clip: {
        width: 64,
        height: 64,
        densities: [1, 2],
        quality: 40,
        effort: 8,
        animation: "preserve",
      },
      sticker: { width: 64, format: "webp", quality: 60, effort: 6, animation: "preserve" },
    },
  })

  it("gives GIF and WebP sources variants that keep the animation", () => {
    const animated = catalog.variants("clip", "uploads/1/a.GIF")

    expect(
      animated.map(({ density, recipe }) => [density, recipe.width, recipe.animation]),
    ).toEqual([
      [1, 64, "preserve"],
      [2, 128, "preserve"],
    ])
    expect(animated.every(({ recipe }) => recipe.format === "webp")).toBe(true)
    expect(catalog.variant("clip", 2, "a.webp")).toBe(animated[1]!)
    for (const path of ["uploads/1/a.jpg", "a.gif/b.jpg", undefined]) {
      expect(catalog.variants("clip", path)[0]!.recipe).toMatchObject({
        animation: "first-frame",
        format: "avif",
      })
    }
  })

  it("builds urls of the animated variants and finds them by hash", () => {
    const target = { path: "uploads/1/a.gif" }
    const [single, double] = catalog.variants("clip", target.path)

    expect(parseRenditionPath(catalog.basePath, catalog.url("clip", target, 2))).toMatchObject({
      label: "clip@2x",
      hash: double!.hash,
      format: "webp",
    })
    expect(catalog.srcset("clip", target)).toBe(
      `${catalog.url("clip", target)} 1x, ${catalog.url("clip", target, 2)} 2x`,
    )
    expect(catalog.findVariant(single!.hash)).toBe(single)
  })

  it("lists every variant once, animated ones included", () => {
    const twin = defineCatalog({
      presets: {
        clip: { width: 64, animation: "preserve" },
        copy: { width: 64, animation: "preserve" },
      },
    })

    expect(catalog.allVariants).toHaveLength(6)
    expect(catalog.allVariants).toEqual(
      expect.arrayContaining([...catalog.variants("clip"), ...catalog.variants("clip", "a.gif")]),
    )
    expect(twin.allVariants.map(variant => variant.hash)).toEqual([
      twin.variant("clip").hash,
      twin.variant("clip", 1, "a.gif").hash,
    ])
  })

  it("keeps the hashes of other sources", () => {
    const before = defineCatalog({ presets: { clip: { width: 64, height: 64 } } })
    const after = defineCatalog({
      presets: { clip: { width: 64, height: 64, animation: "preserve" } },
    })

    expect(after.variant("clip").hash).toBe(before.variant("clip").hash)
  })

  it("takes quality and effort only from a WebP preset", () => {
    expect(catalog.variant("clip", 1, "a.gif").recipe).toMatchObject({ quality: 80, effort: 4 })
    expect(catalog.variant("sticker", 1, "a.gif").recipe).toMatchObject({ quality: 60, effort: 6 })
  })

  it("leaves originals to show sources as they are", () => {
    const shown = defineCatalog({
      presets: { clip: { width: 64, animation: "preserve", originals: ["gif"] } },
    })

    expect(shown.isOriginal("clip", "a.gif")).toBe(true)
    expect(shown.variant("clip", 1, "a.webp").recipe.animation).toBe("preserve")
  })
})

describe("validation", () => {
  it("rejects invalid presets at definition time", () => {
    const invalid = [
      { width: 0 },
      { width: 1.5 },
      { width: 64, quality: 0 },
      { width: 64, effort: 10 },
      { width: 64, format: "jpeg" as const, effort: 10 },
      { width: 64, height: 64, fit: "contain" as const, position: "entropy" as const },
      { width: 64, background: "white" },
      { width: 64, densities: [] },
      { width: 64, densities: [1, 1] },
      { width: 64, densities: [2] },
      { width: 64, originals: [".svg"] },
      { width: 64, originals: ["SVG"] },
      { width: 64, originals: [""] },
      { width: 64, animation: "loop" as never },
    ]
    for (const preset of invalid) {
      expect(() => defineCatalog({ presets: { preset } })).toThrow(RangeError)
    }
    expect(() => defineCatalog({ presets: { "a.b": { width: 64 } } })).toThrow(RangeError)
    // Variant labels are checked too: one too long, and one with a density in exponent notation.
    expect(() =>
      defineCatalog({ presets: { ["a".repeat(64)]: { width: 64, densities: [1, 2] } } }),
    ).toThrow(RangeError)
    expect(() => defineCatalog({ presets: { a: { densities: [1, 1e21] } } })).toThrow(
      'Invalid variant label "a@1e+21x" of preset "a".',
    )
    expect(() => defineCatalog({ basePath: "/img/", presets: {} })).toThrow(RangeError)
    for (const scopes of [[], ["a", "a"], ["a/b"]]) {
      expect(() => defineCatalog({ scopes, presets: {} })).toThrow(RangeError)
    }
  })

  it("ignores an effort in range for formats without one, as defaults apply to every preset", () => {
    const catalog = defineCatalog({
      defaults: { effort: 9 },
      presets: { photo: { width: 64, format: "jpeg" }, icon: { width: 64, format: "png" } },
    })

    expect(catalog.variant("photo").recipe.effort).toBeUndefined()
    expect(catalog.variant("icon").recipe.effort).toBeUndefined()
  })
})
