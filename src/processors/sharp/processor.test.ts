import { describe, expect, test } from "bun:test"

import sharp from "sharp"

import { normalizeRecipe, type RenditionOptions } from "../../recipe"
import { RenditionError } from "../../server/error"

import { createSharpProcessor } from "./processor"

const processor = createSharpProcessor()

function render(source: Uint8Array, options: RenditionOptions) {
  return processor.process(
    source,
    normalizeRecipe({ options: { format: "png", ...options }, pipeline: 1 }),
  )
}

async function solid(width: number, height: number, color: { r: number; g: number; b: number }) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer()
}

describe("encoding", () => {
  test("encodes into the recipe format and resizes into the recipe box", async () => {
    const output = await processor.process(
      await solid(400, 200, { r: 200, g: 0, b: 0 }),
      normalizeRecipe({ options: { width: 64, height: 64 }, pipeline: 1 }),
    )

    expect(output.contentType).toBe("image/avif")
    expect(await sharp(output.data).metadata()).toMatchObject({
      format: "heif",
      width: 64,
      height: 64,
    })
  })

  test("does not enlarge raster sources unless asked", async () => {
    const source = await solid(10, 10, { r: 0, g: 0, b: 0 })

    expect(await sharp((await render(source, { width: 40 })).data).metadata()).toMatchObject({
      width: 10,
    })
    expect(
      await sharp((await render(source, { width: 40, enlarge: true })).data).metadata(),
    ).toMatchObject({
      width: 40,
    })
  })
})

describe("box size", () => {
  // The Nuxt runtime sets `width` and `height` attributes only for outputs that always have the box size.
  test("pads a small source to the box under contain and keeps its size under cover and fill", async () => {
    const source = await solid(20, 10, { r: 0, g: 0, b: 0 })
    const box = { width: 48, height: 48 }

    for (const [fit, size] of [
      ["contain", box],
      ["cover", { width: 20, height: 10 }],
      ["fill", { width: 20, height: 10 }],
    ] as const) {
      expect(await sharp((await render(source, { ...box, fit })).data).metadata()).toMatchObject(
        size,
      )
    }
    expect(
      await sharp((await render(source, { ...box, enlarge: true })).data).metadata(),
    ).toMatchObject(box)
  })
})

describe("source policies", () => {
  test("rasterizes SVG at the size the recipe needs", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"><rect width="10" height="5" fill="#00f"/></svg>',
    )

    const { data } = await render(svg, { width: 200 })

    expect(await sharp(data).metadata()).toMatchObject({ format: "png", width: 200, height: 100 })
  })

  test("renders an animation as its first frame", async () => {
    const frames = await Promise.all([
      solid(8, 8, { r: 255, g: 0, b: 0 }),
      solid(8, 8, { r: 0, g: 0, b: 255 }),
    ])
    const animation = await sharp(frames, { join: { animated: true } })
      .gif()
      .toBuffer()
    expect((await sharp(animation).metadata()).pages).toBe(2)

    const { data } = await render(animation, {})

    const metadata = await sharp(data).metadata()
    const { dominant } = await sharp(data).stats()
    expect(metadata.pages ?? 1).toBe(1)
    expect(dominant.r).toBeGreaterThan(200)
    expect(dominant.b).toBeLessThan(50)
  })

  test("applies EXIF orientation and drops metadata", async () => {
    // Orientation 6 means the stored landscape pixels display rotated by 90° into portrait.
    const rotated = await sharp(await solid(40, 20, { r: 0, g: 128, b: 0 }))
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()

    const { data } = await render(rotated, {})

    const metadata = await sharp(data).metadata()
    expect(metadata).toMatchObject({ width: 20, height: 40 })
    expect(metadata.orientation).toBeUndefined()
    expect(metadata.exif).toBeUndefined()
  })
})

describe("failures", () => {
  test("reports undecodable sources as unsupported", async () => {
    const failure = await render(new TextEncoder().encode("not an image"), { width: 10 }).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(RenditionError)
    expect((failure as RenditionError).reason).toBe("unsupported-source")
  })
})

describe("pixel limit", () => {
  test("rejects a limit that is not a non-negative integer", () => {
    for (const maxInputPixels of [-1, 1.5, Number.NaN]) {
      expect(() => createSharpProcessor({ maxInputPixels })).toThrow(RangeError)
    }
  })

  test("fails sources above it as too large", async () => {
    const limited = createSharpProcessor({ maxInputPixels: 50 })

    const failure = await limited
      .process(
        await solid(10, 10, { r: 0, g: 0, b: 0 }),
        normalizeRecipe({ options: { width: 5 }, pipeline: 1 }),
      )
      .catch((error: unknown) => error)

    expect((failure as RenditionError).reason).toBe("source-too-large")
  })

  test("fails an SVG whose raster would be above it as too large", async () => {
    const limited = createSharpProcessor({ maxInputPixels: 10_000 })
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    )

    const output = await limited.process(
      svg,
      normalizeRecipe({ options: { width: 64 }, pipeline: 1 }),
    )
    const failure = await limited
      .process(svg, normalizeRecipe({ options: { width: 200 }, pipeline: 1 }))
      .catch((error: unknown) => error)

    expect(output.contentType).toBe("image/avif")
    expect((failure as RenditionError).reason).toBe("source-too-large")
  })

  test("is removed by 0", async () => {
    const unlimited = createSharpProcessor({ maxInputPixels: 0 })

    const output = await unlimited.process(
      await solid(10, 10, { r: 0, g: 0, b: 0 }),
      normalizeRecipe({ options: { width: 5 }, pipeline: 1 }),
    )

    expect(output.contentType).toBe("image/avif")
  })
})

describe("side limit", () => {
  const black = { r: 0, g: 0, b: 0 }
  // Enlarged to a width of 30, a strip 1000 times taller than wide would become 30000 pixels tall.
  const strip = () => solid(1, 1000, black)

  test("scales sources that would exceed the limit less, keeping them whole", async () => {
    const turned = await sharp({
      create: { width: 1000, height: 1, channels: 3, background: black },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer()
    // The intrinsic width rounds to 1, but the raster is 51 pixels wide and is enlarged again after rasterization.
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="0.51" height="130"><rect width="1" height="130"/></svg>',
    )
    const cases: [Uint8Array, RenditionOptions, { width: number; height: number }][] = [
      [await strip(), { width: 30, enlarge: true }, { width: 16, height: 16383 }],
      [
        await strip(),
        { width: 30, height: 30, fit: "outside", enlarge: true },
        { width: 16, height: 16383 },
      ],
      [turned, { width: 30, enlarge: true }, { width: 16, height: 16383 }],
      [svg, { width: 100, enlarge: true }, { width: 64, height: 16383 }],
      [await solid(20000, 1, black), {}, { width: 16383, height: 1 }],
    ]

    for (const [source, options, size] of cases) {
      const output = await render(source, options)

      expect(await sharp(output.data).metadata()).toMatchObject(size)
    }
  })

  test("keeps the box under cover and renders what an unlimited cover would", async () => {
    // Each row of the strip has its own shade, and its odd height checks the centered cut for rounding.
    const pixels = new Uint8Array(1001 * 3).map((_, index) => Math.floor(index / 3) % 256)
    const shaded = await sharp(pixels, { raw: { width: 1, height: 1001, channels: 3 } })
      .png()
      .toBuffer()

    for (const position of ["top", "center", "bottom"] as const) {
      const output = await render(shaded, { width: 30, height: 30, position, enlarge: true })
      // The strip is small enough for sharp to scale it whole, which gives the reference.
      const expected = await sharp(shaded)
        .resize({ width: 30, height: 30, fit: "cover", position })
        .raw()
        .toBuffer()

      expect(await sharp(output.data).raw().toBuffer()).toEqual(expected)
    }
    const wide = await render(shaded, { width: 300, height: 30, enlarge: true })
    expect(await sharp(wide.data).metadata()).toMatchObject({ width: 300, height: 30 })
  })

  test("renders a source scaled exactly to the limit", async () => {
    const output = await render(await solid(25, 1, black), { width: 16383, enlarge: true })

    expect(await sharp(output.data).metadata()).toMatchObject({ width: 16383, height: 655 })
  })

  test("fills the box with elongated vector sources under cover and fill", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="1"><rect width="200" height="1"/></svg>',
    )

    for (const fit of ["cover", "fill"] as const) {
      const output = await render(svg, { width: 100, height: 100, fit })

      expect(await sharp(output.data).metadata()).toMatchObject({ width: 100, height: 100 })
    }
  })

  test("renders sources that stay within the limit as the recipe sets", async () => {
    const cases: [RenditionOptions, { width: number; height: number }][] = [
      [{ width: 30 }, { width: 1, height: 1000 }],
      [
        { width: 30, height: 30, fit: "fill", enlarge: true },
        { width: 30, height: 30 },
      ],
      [
        { width: 30, height: 30, fit: "contain", enlarge: true },
        { width: 30, height: 30 },
      ],
      [
        { width: 30, height: 30, fit: "inside", enlarge: true },
        { width: 1, height: 30 },
      ],
    ]

    for (const [options, size] of cases) {
      const output = await render(await strip(), options)

      expect(await sharp(output.data).metadata()).toMatchObject(size)
    }
  })
})
