import type { Recipe } from "../recipe"

import type { EncodedImage } from "./stores"

/** Shortfall of a rendered image against its recipe, which a processor reports. */
export interface Degradation {
  /** Code of the shortfall, such as `animation-frames`. */
  reason: string
  /** Human-readable description with the values involved, such as an exceeded limit. */
  message: string
}

/** Image a processor renders. */
export interface ProcessedImage extends EncodedImage {
  /**
   * Shortfall the processor detected, such as the first frame of an animation beyond a limit.
   *
   * Its absence does not promise that the image renders the recipe in full.
   */
  degradation?: Degradation
}

/** Renders a source image according to a recipe. */
export interface Processor {
  /**
   * Renders the source.
   *
   * Rejects with a `RenditionError` of reason `unsupported-source` when the source cannot be decoded or processed, and of reason `source-too-large` when it exceeds a size limit.
   */
  process(source: Uint8Array, recipe: Recipe): Promise<ProcessedImage>
  /**
   * Checks that the processor renders a recipe as it describes.
   *
   * `createRenditionServer()` checks every variant of its catalog with it, and `ensure()` every recipe it gets.
   *
   * @throws {RangeError} When the processor cannot render the recipe, such as an animation in a format it cannot encode.
   */
  assertRecipe?(recipe: Recipe): void
}
