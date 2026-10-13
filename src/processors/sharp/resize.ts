// Resize geometry of the sharp processor, kept apart from the pipeline so it can be tested without rendering.

import type { Region, ResizeOptions } from "sharp"

import { MAX_DIMENSION, type Recipe } from "../../recipe"

/**
 * Plans the crop and resize of a source of the given size; an absent step is skipped.
 *
 * An image the recipe would scale beyond {@link MAX_DIMENSION} on a side is scaled less, so it stays whole and comes out smaller than the recipe box.
 * Under `cover`, the long side is cut before scaling instead, so the rendition keeps the box.
 */
export function planResize(
  recipe: Recipe,
  width: number,
  height: number,
): { extract?: Region; resize?: ResizeOptions } {
  const options: ResizeOptions = {
    width: recipe.width,
    height: recipe.height,
    fit: recipe.fit,
    position: recipe.position,
    background: recipe.background && parseColor(recipe.background),
    withoutEnlargement: !recipe.enlarge,
  }
  const sized = recipe.width !== undefined || recipe.height !== undefined
  const scale = resizeScale(recipe, width, height) ?? 1
  const factor = recipe.enlarge ? scale : Math.min(scale, 1)
  const longest = Math.max(width, height)
  // `fill`, `contain` and `inside` never exceed the box, which is within the limit.
  if (Math.round(longest * factor) <= MAX_DIMENSION || recipe.fit === "fill") {
    return { resize: sized ? options : undefined }
  }
  if (recipe.fit === "cover") {
    // The image is cropped to the box after scaling, so only an enlarged one can grow beyond the limit before the crop.
    if (factor <= 1) {
      return { resize: options }
    }
    // `cover` keeps a box-sized window of the scaled image, so cutting the long side before scaling at the window's position keeps the rendition the same.
    // `entropy` and `attention` then search the centered part only.
    const vertical = height > width
    const across = vertical ? width : height
    // The other side drives the scale here, since the long one overflows; the product before one division keeps the length exact.
    const boxAcross = vertical ? recipe.width! : recipe.height!
    const boxAlong = vertical ? recipe.height! : recipe.width!
    const fitting = Math.floor((MAX_DIMENSION * across) / boxAcross)
    const start = recipe.position === (vertical ? "top" : "left")
    const end = recipe.position === (vertical ? "bottom" : "right")
    // A centered cut needs an even remainder, since an odd one would shift the center by half a source pixel, which scaling magnifies.
    // It is shortened for that only while the other side still drives the scale, which keeps the scaled cut within the limit.
    const shorten =
      !start &&
      !end &&
      (longest - fitting) % 2 === 1 &&
      (fitting - 1) * boxAcross >= boxAlong * across
    const length = shorten ? fitting - 1 : fitting
    const slack = longest - length
    const offset = start ? 0 : end ? slack : Math.floor(slack / 2)
    return {
      extract: vertical
        ? { left: 0, top: offset, width, height: length }
        : { left: offset, top: 0, width: length, height },
      resize: options,
    }
  }
  // A single side, `outside` and no size leave the long side free, so the image is fit within the limit on it.
  const box = recipe.fit === "outside" ? {} : { width: recipe.width, height: recipe.height }
  return {
    resize: {
      width: box.width ?? MAX_DIMENSION,
      height: box.height ?? MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: !recipe.enlarge,
    },
  }
}

/**
 * Factor that brings a source of the given size to the recipe box, before any `enlarge` limit.
 *
 * Returns `undefined` when the recipe sets no size or the source size is unknown.
 * For `fill`, it is the factor of the side that needs more scaling.
 */
export function resizeScale(
  { width, height, fit }: Recipe,
  sourceWidth: number,
  sourceHeight: number,
) {
  const scales = [
    width && sourceWidth ? width / sourceWidth : undefined,
    height && sourceHeight ? height / sourceHeight : undefined,
  ].filter(scale => scale !== undefined)
  if (scales.length === 0) {
    return undefined
  }
  // Fits that keep the whole image inside the box are limited by the smaller scale; the rest must cover the box.
  return fit === "inside" || fit === "contain" ? Math.min(...scales) : Math.max(...scales)
}

/** Converts a normalized `#rrggbbaa` color to the form sharp accepts. */
export function parseColor(color: string) {
  const channel = (index: number) => Number.parseInt(color.slice(1 + index * 2, 3 + index * 2), 16)
  return { r: channel(0), g: channel(1), b: channel(2), alpha: channel(3) / 255 }
}
