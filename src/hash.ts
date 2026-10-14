import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"

import { type Recipe, serializeRecipe } from "./recipe"

/**
 * Length of a recipe hash in hex digits, which keeps 48 bits of SHA-256.
 *
 * It tells apart the few thousand recipes an application may have over its lifetime, and a catalog rejects a collision among its own recipes.
 */
const RECIPE_HASH_LENGTH = 12

/** Identifies a recipe by the truncated SHA-256 of its canonical serialization. */
export function hashRecipe(recipe: Recipe): string {
  return bytesToHex(sha256(utf8ToBytes(serializeRecipe(recipe)))).slice(0, RECIPE_HASH_LENGTH)
}
