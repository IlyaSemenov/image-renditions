import { defineCatalog } from "image-renditions"

const variant = defineCatalog({ presets: { avatar: { width: 48 } } }).variant("avatar")

// Variants and their recipes are read-only, so a recipe keeps matching its hash.
export function mutateVariant() {
  // @ts-expect-error A recipe field is read-only.
  variant.recipe.width = 100
  // @ts-expect-error A variant field is read-only.
  variant.hash = "0"
}
