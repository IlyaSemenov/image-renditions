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
}
