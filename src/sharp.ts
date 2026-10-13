import sharp, { type Sharp } from "sharp"

import type { Recipe, RenditionFormat } from "./recipe"
import { RenditionError } from "./server/error"
import type { Processor } from "./server/processor"

/** Options of {@link createSharpProcessor}. */
export interface SharpProcessorOptions {
  /** Largest decoded source, in pixels; larger sources are unsupported. */
  maxInputPixels?: number
}

/** Rasterization density SVG renders at when no scaling is needed, in DPI. */
const SVG_BASE_DENSITY = 72

const contentTypes: Record<RenditionFormat, string> = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
}

/** Creates a processor backed by sharp and libvips. */
export function createSharpProcessor({
  maxInputPixels = 100_000_000,
}: SharpProcessorOptions = {}): Processor {
  return {
    async process(source, recipe) {
      // Decoding and transformation run separately from encoding, so a source failure is told apart from an encoder failure without parsing error messages.
      const { data, info } = await decode(source, recipe, maxInputPixels).catch(
        (error: unknown) => {
          throw new RenditionError("unsupported-source", "The source cannot be decoded.", {
            cause: error,
          })
        },
      )
      const encoded = await encode(
        sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }),
        recipe,
      ).catch((error: unknown) => {
        throw new RenditionError("processing-failed", "The rendition cannot be encoded.", {
          cause: error,
        })
      })
      return { data: new Uint8Array(encoded), contentType: contentTypes[recipe.format] }
    },
  }
}

async function decode(source: Uint8Array, recipe: Recipe, maxInputPixels: number) {
  const input = { failOn: "error", limitInputPixels: maxInputPixels } as const
  const metadata = await sharp(source, input).metadata()
  const density =
    metadata.format === "svg" ? svgDensity(recipe, metadata.width, metadata.height) : undefined
  // Only the first page or frame is read, which renders animations as their first frame.
  let pipeline = sharp(source, { ...input, density, pages: 1 }).autoOrient()
  if (recipe.width !== undefined || recipe.height !== undefined) {
    pipeline = pipeline.resize({
      width: recipe.width,
      height: recipe.height,
      fit: recipe.fit,
      position: recipe.position,
      background: recipe.background && parseColor(recipe.background),
      withoutEnlargement: !recipe.enlarge,
    })
  }
  if (recipe.format === "jpeg") {
    pipeline = pipeline.flatten({ background: parseColor(recipe.background!) })
  }
  return pipeline
    .toColourspace("srgb")
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true })
}

function encode(pipeline: Sharp, recipe: Recipe) {
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

/**
 * Picks the DPI that rasterizes an SVG at least at the size the recipe needs.
 *
 * Vector sources thus fill the target box regardless of `enlarge`, while raster sources stay limited by it.
 */
function svgDensity({ width, height, fit }: Recipe, intrinsicWidth = 0, intrinsicHeight = 0) {
  const scales = [
    width && intrinsicWidth ? width / intrinsicWidth : undefined,
    height && intrinsicHeight ? height / intrinsicHeight : undefined,
  ].filter(scale => scale !== undefined)
  if (scales.length === 0) {
    return SVG_BASE_DENSITY
  }
  // Fits that keep the whole image inside the box are limited by the smaller scale; the rest must cover the box.
  const scale = fit === "inside" || fit === "contain" ? Math.min(...scales) : Math.max(...scales)
  return Math.min(Math.max(SVG_BASE_DENSITY * scale, 1), 100_000)
}

/** Converts a normalized `#rrggbbaa` color to the form sharp accepts. */
function parseColor(color: string) {
  const channel = (index: number) => Number.parseInt(color.slice(1 + index * 2, 3 + index * 2), 16)
  return { r: channel(0), g: channel(1), b: channel(2), alpha: channel(3) / 255 }
}
