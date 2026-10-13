import sharp from "sharp"

import { formatContentTypes, MAX_DIMENSION, type Recipe } from "../../recipe"
import { RenditionError } from "../../server/error"
import type { Processor } from "../../server/processor"

import { parseColor, planResize, resizeScale } from "./resize"

/** Options of {@link createSharpProcessor}. */
export interface SharpProcessorOptions {
  /** Largest decoded source, in pixels; larger sources are unsupported. */
  maxInputPixels?: number
}

/** Rasterization density SVG renders at when no scaling is needed, in DPI. */
const SVG_BASE_DENSITY = 72

/** Creates a processor backed by sharp and libvips. */
export function createSharpProcessor({
  maxInputPixels = 100_000_000,
}: SharpProcessorOptions = {}): Processor {
  return {
    async process(source, recipe) {
      // One pipeline avoids a separate buffer of decoded pixels, so its failures are not told apart and all count as source failures, as most of them are.
      const data = await render(source, recipe, maxInputPixels).catch((error: unknown) => {
        throw new RenditionError("unsupported-source", "The source cannot be processed.", {
          cause: error,
        })
      })
      return { data: new Uint8Array(data), contentType: formatContentTypes[recipe.format] }
    },
  }
}

async function render(source: Uint8Array, recipe: Recipe, maxInputPixels: number) {
  const input = { failOn: "error", limitInputPixels: maxInputPixels } as const
  const metadata = await sharp(source, input).metadata()
  // Resizing applies to the image after EXIF orientation, which may swap its sides.
  let { width, height } = metadata.autoOrient
  let density: number | undefined
  if (metadata.format === "svg") {
    // Vector sources are rasterized at the size the recipe needs, so they fill the box regardless of `enlarge`.
    // Where the long side stays in the rendition, the raster also stays within the side limit, while `cover` and `fill` cut it to the box anyway.
    const needed = resizeScale(recipe, width, height) ?? 1
    const scale =
      recipe.fit === "cover" || recipe.fit === "fill"
        ? needed
        : Math.min(needed, MAX_DIMENSION / Math.max(width, height, 1))
    density = Math.min(Math.max(SVG_BASE_DENSITY * scale, 1), 100_000)
    // The intrinsic size is rounded, so the size of the raster is read rather than computed.
    const raster = (await sharp(source, { ...input, density }).metadata()).autoOrient
    width = raster.width
    height = raster.height
  }
  // Only the first page or frame is read, which renders animations as their first frame.
  let pipeline = sharp(source, { ...input, density, pages: 1 }).autoOrient()
  const { extract, resize } = planResize(recipe, width, height)
  // Extracting before resizing crops the source rather than the result.
  if (extract) {
    pipeline = pipeline.extract(extract)
  }
  if (resize) {
    pipeline = pipeline.resize(resize)
  }
  if (recipe.format === "jpeg") {
    pipeline = pipeline.flatten({ background: parseColor(recipe.background!) })
  }
  pipeline = pipeline.toColourspace("srgb")
  switch (recipe.format) {
    case "avif":
      return pipeline.avif({ quality: recipe.quality, effort: recipe.effort }).toBuffer()
    case "webp":
      return pipeline.webp({ quality: recipe.quality, effort: recipe.effort }).toBuffer()
    case "jpeg":
      return pipeline.jpeg({ quality: recipe.quality }).toBuffer()
    case "png":
      return pipeline.png().toBuffer()
  }
}
