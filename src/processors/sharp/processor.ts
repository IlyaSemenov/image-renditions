import sharp, { type Metadata } from "sharp"

import { assertInteger } from "../../assert"
import { formatContentTypes, MAX_DIMENSION, type Recipe } from "../../recipe"
import { RenditionError } from "../../server/error"
import type { Processor } from "../../server/processor"

import { computeResizeScale, estimateRenditionArea, parseColor, planResize } from "./resize"

/** Options of {@link createSharpProcessor}. */
export interface SharpProcessorOptions {
  /** Largest decoded source, in pixels; larger sources fail as too large, and `0` removes the limit. */
  maxInputPixels?: number
  /**
   * Largest animation a recipe keeps, in pixels of all its frames at the larger of the source and the rendition size; `0` removes the limit.
   *
   * A larger animation renders its first frame.
   */
  maxAnimationPixels?: number
  /** Most frames of an animation a recipe keeps; an animation with more renders its first frame, and `0` removes the limit. */
  maxFrames?: number
}

/** Animation limits of {@link createSharpProcessor}. */
interface AnimationLimits {
  maxAnimationPixels: number
  maxFrames: number
}

/** Rasterization density SVG renders at when no scaling is needed, in DPI. */
const SVG_BASE_DENSITY = 72

/**
 * Creates a processor backed by sharp and libvips.
 *
 * @throws {RangeError} When a limit is not a non-negative integer.
 */
export function createSharpProcessor({
  maxInputPixels = 100_000_000,
  maxAnimationPixels = 50_000_000,
  maxFrames = 1000,
}: SharpProcessorOptions = {}): Processor {
  assertInteger("maxInputPixels", maxInputPixels, 0, Number.MAX_SAFE_INTEGER)
  assertInteger("maxAnimationPixels", maxAnimationPixels, 0, Number.MAX_SAFE_INTEGER)
  assertInteger("maxFrames", maxFrames, 0, Number.MAX_SAFE_INTEGER)
  const limits = { maxAnimationPixels, maxFrames }
  return {
    assertRecipe,
    async process(source, recipe) {
      assertRecipe(recipe)
      // One pipeline avoids a separate buffer of decoded pixels, so its failures are not told apart and all count as source failures, as most of them are.
      // Failures detected before the pipeline, such as the pixel limit, keep their own reason.
      const data = await render(source, recipe, maxInputPixels, limits).catch((error: unknown) => {
        throw error instanceof RenditionError
          ? error
          : new RenditionError("unsupported-source", "The source cannot be processed.", {
              cause: error,
            })
      })
      return { data: new Uint8Array(data), contentType: formatContentTypes[recipe.format] }
    },
  }
}

async function render(
  source: Uint8Array,
  recipe: Recipe,
  maxInputPixels: number,
  limits: AnimationLimits,
) {
  const input = { failOn: "error", limitInputPixels: maxInputPixels } as const
  // Sharp would fail a source over the limit like an undecodable one, so the limit is checked here and the pipeline keeps it only as a safeguard.
  const metadata = await sharp(source, { ...input, limitInputPixels: false }).metadata()
  assertPixels(metadata.width, metadata.height, maxInputPixels)
  // Resizing applies to the image after EXIF orientation, which may swap its sides.
  let { width, height } = metadata.autoOrient
  let density: number | undefined
  if (metadata.format === "svg") {
    // Vector sources are rasterized at the size the recipe needs, so they fill the box regardless of `enlarge`.
    // Where the long side stays in the rendition, the raster also stays within the side limit, while `cover` and `fill` cut it to the box anyway.
    const needed = computeResizeScale(recipe, width, height) ?? 1
    const scale =
      recipe.fit === "cover" || recipe.fit === "fill"
        ? needed
        : Math.min(needed, MAX_DIMENSION / Math.max(width, height, 1))
    density = Math.min(Math.max(SVG_BASE_DENSITY * scale, 1), 100_000)
    // The intrinsic size is rounded, so the size of the raster is read rather than computed.
    const raster = (await sharp(source, { ...input, density, limitInputPixels: false }).metadata())
      .autoOrient
    assertPixels(raster.width, raster.height, maxInputPixels)
    width = raster.width
    height = raster.height
  }
  // An animation the recipe keeps is read whole, and its pixel limit covers all frames, which the budget check has kept within the animation limit.
  // Otherwise only the first page or frame is read, which renders an animation as its first frame.
  const frames = keepsAnimation(recipe, metadata, limits)
    ? { animated: true, limitInputPixels: limits.maxAnimationPixels }
    : { pages: 1 }
  let pipeline = sharp(source, { ...input, density, ...frames }).autoOrient()
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

/**
 * Whether a rendition keeps the animation of a source, judged by the metadata of its first frame.
 *
 * Sharp resizes and crops the frames one by one, so the planned geometry of the first frame applies to every frame.
 */
function keepsAnimation(
  recipe: Recipe,
  { format, pages = 1, width, height, orientation = 1 }: Metadata,
  { maxAnimationPixels, maxFrames }: AnimationLimits,
) {
  // Pages of other formats, such as TIFF, are not frames of an animation.
  // Sharp cannot apply EXIF orientation to several frames.
  if (
    recipe.animation !== "preserve" ||
    (format !== "gif" && format !== "webp") ||
    pages < 2 ||
    orientation !== 1
  ) {
    return false
  }
  // Every frame is decoded and encoded, so the budget covers the larger of the source and the rendition.
  const pixels = Math.max(width * height, estimateRenditionArea(recipe, width, height)) * pages
  return (
    (maxFrames === 0 || pages <= maxFrames) &&
    (maxAnimationPixels === 0 || pixels <= maxAnimationPixels)
  )
}

/**
 * Checks that sharp can keep an animation where a recipe asks for it.
 *
 * @throws {RangeError} When the recipe keeps an animation in a format other than `webp` or crops it by content.
 */
function assertRecipe({ animation, format, position }: Recipe) {
  if (animation !== "preserve") {
    return
  }
  if (format !== "webp") {
    throw new RangeError(`Animations cannot be encoded as ${format}.`)
  }
  // Content-aware cropping looks at one image, so sharp does not apply it to the frames of an animation.
  if (position === "entropy" || position === "attention") {
    throw new RangeError(`Position "${position}" cannot crop an animation.`)
  }
}

/** Fails as `source-too-large` when an image of the size exceeds the pixel limit, unless the limit is `0`. */
function assertPixels(width: number, height: number, maxInputPixels: number) {
  if (maxInputPixels > 0 && width * height > maxInputPixels) {
    throw new RenditionError(
      "source-too-large",
      `The source of ${width}×${height} pixels exceeds the limit of ${maxInputPixels}.`,
    )
  }
}
