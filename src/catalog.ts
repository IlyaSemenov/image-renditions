import { hashRecipe } from "./hash"
import { normalizeRecipe, type Recipe, type RenditionOptions, type SourcePolicy } from "./recipe"
import { assertBasePath, DEFAULT_BASE_PATH, formatRenditionPath } from "./url"

/** Named transformation in a catalog. */
export interface PresetDefinition extends RenditionOptions {
  /** Pixel densities to render, as multipliers of `width` and `height`; defaults to `[1]`. */
  densities?: readonly number[]
}

/** Shared configuration of renditions, imported by both the client and the server. */
export interface CatalogDefinition<Name extends string = string> {
  /** Path the rendition handler is mounted at, `/_renditions` by default. */
  basePath?: string
  /** Bumping it gives every variant a new hash, so every rendition is generated again. */
  pipelineVersion?: number
  /** Options of every preset; a preset overrides them field by field. */
  defaults?: PresetDefinition
  /** How special kinds of sources are rendered. */
  sources?: Partial<SourcePolicy>
  presets: Record<Name, PresetDefinition>
}

/** One density of a preset, which is a separate recipe with its own hash. */
export interface RenditionVariant {
  readonly preset: string
  readonly density: number
  /** Readable URL label, such as `avatar` or `avatar@2x`. */
  readonly label: string
  readonly recipe: Recipe
  readonly hash: string
}

/** Source a rendition is made from. */
export interface RenditionTarget {
  /** Application-defined space of the path, such as a tenant; omitted when the application has one space. */
  scope?: string
  /** Logical source path inside the scope. */
  path: string
}

/** Validated catalog with its variants and URL builders. */
export interface Catalog<Name extends string = string> {
  readonly basePath: string
  readonly presets: readonly Name[]
  /** Variants of a preset ordered by density. */
  variants(preset: Name): readonly RenditionVariant[]
  /**
   * Variant of a preset at a density, `1` by default.
   *
   * @throws {RangeError} When the preset does not declare the density.
   */
  variant(preset: Name, density?: number): RenditionVariant
  /** Variant with a recipe hash, if the catalog has one. */
  findVariant(hash: string): RenditionVariant | undefined
  /**
   * Root-relative URL of a rendition.
   *
   * @throws {RangeError} When the preset is unknown or does not declare the density, or the scope or path is unsafe to put into the URL.
   */
  url(preset: Name, target: RenditionTarget, density?: number): string
  /**
   * `srcset` attribute value listing every density of a preset.
   *
   * @throws {RangeError} When the preset is unknown, or the scope or path is unsafe to put into the URL.
   */
  srcset(preset: Name, target: RenditionTarget): string
}

/**
 * Validates a catalog and computes the recipe and hash of every preset density.
 *
 * Preset names are only labels: renaming a preset keeps its hashes and thus its stored renditions.
 *
 * @throws {RangeError} When the catalog is invalid.
 */
export function defineCatalog<const Name extends string>(
  definition: CatalogDefinition<Name>,
): Catalog<Name> {
  const basePath = definition.basePath ?? DEFAULT_BASE_PATH
  assertBasePath(basePath)
  const pipeline = definition.pipelineVersion ?? 1
  const presets = Object.freeze(Object.keys(definition.presets) as Name[])

  // The catalog and its variants are frozen, so a recipe keeps matching the hash computed for it here.
  const variantsByPreset = new Map<Name, readonly RenditionVariant[]>()
  const variantsByHash = new Map<string, RenditionVariant>()
  for (const preset of presets) {
    if (!/^[\w-]{1,64}$/.test(preset)) {
      throw new RangeError(`Invalid preset name "${preset}".`)
    }
    const { densities = [1], ...options } = {
      ...definition.defaults,
      ...withoutUndefined(definition.presets[preset]),
    }
    if (densities.length === 0 || new Set(densities).size !== densities.length) {
      throw new RangeError(`Preset "${preset}" must declare unique densities.`)
    }
    const variants = Object.freeze(
      [...densities]
        .sort((a, b) => a - b)
        .map((density): RenditionVariant => {
          const recipe = wrapRangeError(`preset "${preset}"`, () =>
            normalizeRecipe({ options, density, pipeline, policy: definition.sources }),
          )
          return Object.freeze({
            preset,
            density,
            label: density === 1 ? preset : `${preset}@${density}x`,
            recipe,
            hash: hashRecipe(recipe),
          })
        }),
    )
    variantsByPreset.set(preset, variants)
    for (const variant of variants) {
      // Presets with equal recipes share renditions, so either variant describes the hash correctly.
      if (!variantsByHash.has(variant.hash)) {
        variantsByHash.set(variant.hash, variant)
      }
    }
  }

  function variants(preset: Name) {
    const found = variantsByPreset.get(preset)
    if (!found) {
      throw new RangeError(`Unknown rendition preset "${preset}".`)
    }
    return found
  }

  function variant(preset: Name, density = 1) {
    const found = variants(preset).find(variant => variant.density === density)
    if (!found) {
      throw new RangeError(`Preset "${preset}" has no density ${density}.`)
    }
    return found
  }

  function variantUrl({ label, hash, recipe }: RenditionVariant, { scope, path }: RenditionTarget) {
    return formatRenditionPath(basePath, { scope, label, hash, format: recipe.format, path })
  }

  return Object.freeze<Catalog<Name>>({
    basePath,
    presets,
    variants,
    variant,
    findVariant: hash => variantsByHash.get(hash),
    url: (preset, target, density) => variantUrl(variant(preset, density), target),
    srcset: (preset, target) =>
      variants(preset)
        .map(variant => `${variantUrl(variant, target)} ${variant.density}x`)
        .join(", "),
  })
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>
}

function wrapRangeError<T>(context: string, fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    throw error instanceof RangeError
      ? new RangeError(`Invalid ${context}: ${error.message}`, { cause: error })
      : error
  }
}
