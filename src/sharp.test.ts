import { describe, expect, test } from "bun:test"

import sharp from "sharp"

import { normalizeRecipe, type RenditionOptions } from "./recipe"
import { RenditionError } from "./server/error"
import { createSharpProcessor } from "./sharp"

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

  test("reports sources above the pixel limit as unsupported", async () => {
    const limited = createSharpProcessor({ maxInputPixels: 50 })

    const failure = await limited
      .process(
        await solid(10, 10, { r: 0, g: 0, b: 0 }),
        normalizeRecipe({ options: { width: 5 }, pipeline: 1 }),
      )
      .catch((error: unknown) => error)

    expect((failure as RenditionError).reason).toBe("unsupported-source")
  })
})
