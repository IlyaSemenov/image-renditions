import type { Recipe } from "../recipe"

import type { EncodedImage } from "./stores"

/** Renders a source image according to a recipe. */
export interface Processor {
  /**
   * Renders the source.
   *
   * Rejects with a `RenditionError` of reason `unsupported-source` when the source cannot be decoded or processed, and of reason `source-too-large` when it exceeds a size limit.
   */
  process(source: Uint8Array, recipe: Recipe): Promise<EncodedImage>
  /**
   * Checks that the processor renders a recipe as it describes.
   *
   * `createRenditionServer()` checks every variant of its catalog with it, and `ensure()` every recipe it gets.
   *
   * @throws {RangeError} When the processor cannot render the recipe, such as an animation in a format it cannot encode.
   */
  assertRecipe?(recipe: Recipe): void
}
