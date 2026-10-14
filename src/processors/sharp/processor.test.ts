import { describe, expect, test } from "bun:test"

import sharp from "sharp"

import { normalizeRecipe, type RenditionOptions } from "../../recipe"
import { RenditionError } from "../../server/error"

import { createSharpProcessor } from "./processor"
import { planResize } from "./resize"

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

describe("animation", () => {
  const colors = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
  ]

  async function createAnimation(width: number, height: number) {
    const frames = await Promise.all(colors.map(color => solid(width, height, color)))
    return sharp(frames, { join: { animated: true } })
      .gif({ delay: [100, 200, 300], loop: 2 })
      .toBuffer()
  }

  function preserve(options: RenditionOptions) {
    return normalizeRecipe({
      options: { format: "webp", ...options },
      pipeline: 1,
      animation: "preserve",
    })
  }

  /** Strongest channel at the center of every frame, such as `r` for a red one. */
  async function readFrameColors(data: Uint8Array) {
    const { data: pixels, info } = await sharp(data, { animated: true })
      .raw()
      .toBuffer({ resolveWithObject: true })
    const frameHeight = info.pageHeight ?? info.height
    return Array.from({ length: info.height / frameHeight }, (_, frame) => {
      const y = frame * frameHeight + Math.floor(frameHeight / 2)
      const offset = (y * info.width + Math.floor(info.width / 2)) * info.channels
      const [r = 0, g = 0, b = 0] = pixels.subarray(offset, offset + 3)
      return r > g && r > b ? "r" : g > b ? "g" : "b"
    })
  }

  test("keeps the frames, their delays and the loop count under cover and contain", async () => {
    const source = await createAnimation(40, 20)

    for (const fit of ["cover", "contain"] as const) {
      const output = await processor.process(source, preserve({ width: 16, height: 16, fit }))

      expect(output.contentType).toBe("image/webp")
      expect(await sharp(output.data).metadata()).toMatchObject({
        width: 16,
        height: 16,
        pages: 3,
        delay: [100, 200, 300],
        loop: 2,
      })
      expect(await readFrameColors(output.data)).toEqual(["r", "g", "b"])
    }
  })

  test("cuts every frame before scaling an elongated source beyond the side limit", async () => {
    const recipe = preserve({ width: 400, height: 100, enlarge: true })
    expect(planResize(recipe, 2, 200).extract).toBeDefined()

    const { data } = await processor.process(await createAnimation(2, 200), recipe)

    expect(await sharp(data).metadata()).toMatchObject({ width: 400, height: 100, pages: 3 })
    expect(await readFrameColors(data)).toEqual(["r", "g", "b"])
  })

  test("renders a single frame as a still image", async () => {
    const source = await sharp(await solid(8, 8, colors[0]!))
      .gif()
      .toBuffer()

    const { data } = await processor.process(source, preserve({}))

    expect((await sharp(data).metadata()).pages ?? 1).toBe(1)
  })

  test("renders the first frame of an animation beyond a limit", async () => {
    const source = await createAnimation(40, 20)
    // Small frames padded to a large box count at the size of the rendition.
    const small = await createAnimation(4, 4)

    for (const [limited, input, options] of [
      [createSharpProcessor({ maxFrames: 2 }), source, {}],
      [createSharpProcessor({ maxAnimationPixels: 2000 }), source, {}],
      [
        createSharpProcessor({ maxAnimationPixels: 2000 }),
        small,
        { width: 40, height: 40, fit: "contain" },
      ],
    ] as const) {
      const { data } = await limited.process(input, preserve(options))

      expect(await readFrameColors(data)).toEqual(["r"])
    }
    const unlimited = createSharpProcessor({ maxAnimationPixels: 0, maxFrames: 0 })
    expect(
      await readFrameColors((await unlimited.process(source, preserve({}))).data),
    ).toHaveLength(3)
  })

  test("renders the first frame of an animation with an EXIF orientation", async () => {
    const oriented = await sharp(await createAnimation(40, 20), { animated: true })
      .webp()
      .withMetadata({ orientation: 6 })
      .toBuffer()

    const { data } = await processor.process(oriented, preserve({}))

    expect(await sharp(data).metadata()).toMatchObject({ width: 20, height: 40 })
    expect(await readFrameColors(data)).toEqual(["r"])
  })

  test("counts the rendition size of every frame against the budget, with sides rounded up", async () => {
    // Frames of 3×2 scaled to a width of 4 become 4×3, so three of them take 36 pixels.
    const source = await createAnimation(3, 2)
    const recipe = preserve({ width: 4, enlarge: true })

    for (const [maxAnimationPixels, frames] of [
      [36, 3],
      [35, 1],
    ]) {
      const { data } = await createSharpProcessor({ maxAnimationPixels }).process(source, recipe)

      expect(await readFrameColors(data)).toHaveLength(frames!)
    }
  })

  test("rejects animations it cannot encode or crop", async () => {
    const recipes = [
      normalizeRecipe({ options: {}, pipeline: 1, animation: "preserve" }),
      preserve({ width: 16, height: 16, position: "attention" }),
    ]

    const source = await createAnimation(40, 20)

    for (const recipe of recipes) {
      expect(() => processor.assertRecipe!(recipe)).toThrow(RangeError)
      await expect(processor.process(source, recipe)).rejects.toThrow(RangeError)
    }
    expect(() =>
      processor.assertRecipe!(
        normalizeRecipe({ options: { width: 16, height: 16, position: "attention" }, pipeline: 1 }),
      ),
    ).not.toThrow()
  })

  test("rejects limits that are not non-negative integers", () => {
    for (const name of ["maxAnimationPixels", "maxFrames"] as const) {
      for (const value of [-1, 1.5, Number.NaN]) {
        expect(() => createSharpProcessor({ [name]: value })).toThrow(RangeError)
      }
    }
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
