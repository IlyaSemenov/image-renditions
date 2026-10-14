import { hashRecipe } from "./hash"
import { isSafeScope } from "./path"
import {
  normalizeRecipe,
  type Recipe,
  type RenditionAnimation,
  type RenditionOptions,
  serializeRecipe,
  type SourcePolicy,
} from "./recipe"
import { assertDeclaredScope } from "./scopes"
import { assertBasePath, DEFAULT_BASE_PATH, formatRenditionPath } from "./url"

/** Named transformation in a catalog. */
export interface PresetDefinition extends RenditionOptions {
  /** Pixel densities to render, as multipliers of `width` and `height`, which include `1`; defaults to `[1]`. */
  densities?: readonly number[]
  /**
   * Extensions of source files shown as they are instead of rendered, such as `svg`, in lowercase and without the dot.
   *
   * Such sources are shown as they are whatever the other options, including `animation`.
   * They do not affect hashes, and the server still renders such a source when its rendition URL is requested.
   */
  originals?: readonly string[]
  /**
   * How renditions show animated sources; `first-frame` by default.
   *
   * With `preserve`, sources with the `gif` or `webp` extension get variants of their own in `webp` that keep the animation, which take `quality` and `effort` only from a `webp` preset.
   * The variants of other sources keep their hashes.
   */
  animation?: RenditionAnimation
}

/** Extensions of sources that get animated variants, as a path does not tell an animated source from a still one. */
const ANIMATED_EXTENSIONS: readonly string[] = ["gif", "webp"]

/** Shared configuration of renditions, imported by both the client and the server. */
export interface CatalogDefinition<Name extends string = string, Scope extends string = string> {
  /** Path the rendition handler is mounted at, `/_renditions` by default. */
  basePath?: string
  /** Bumping it gives every variant a new hash, so every rendition is generated again. */
  pipelineVersion?: number
  /** Options of every preset; a preset overrides them field by field. */
  defaults?: PresetDefinition
  /** How special kinds of sources are rendered. */
  sources?: Partial<SourcePolicy>
  /**
   * Scopes a logical path can belong to, such as `tenant`; every target then has one of them.
   *
   * Without them, a target may have any scope or none.
   */
  scopes?: readonly Scope[]
  presets: Record<Name, PresetDefinition>
}

/**
 * One density of a preset, which is a separate recipe with its own hash.
 *
 * A preset that preserves animation has a second variant at each density for GIF and WebP sources.
 */
export interface RenditionVariant {
  readonly preset: string
  readonly density: number
  /** Readable URL label, such as `avatar` or `avatar@2x`. */
  readonly label: string
  readonly recipe: Recipe
  readonly hash: string
}

/**
 * Source a rendition is made from.
 *
 * `Scope` is the union of the scopes a catalog declares, which makes `scope` required, or `string` for a catalog without them.
 */
export type RenditionTarget<Scope extends string = string> = {
  /** Logical source path inside the scope. */
  path: string
} & (string extends Scope
  ? {
      /** Application-defined space of the path, such as a tenant; omitted when the application has one space. */
      scope?: string
    }
  : {
      /** Space of the path, one of the scopes of the catalog. */
      scope: Scope
    })

/** Validated catalog with its variants and URL builders. */
export interface Catalog<Name extends string = string, Scope extends string = string> {
  readonly basePath: string
  readonly presets: readonly Name[]
  /** Scopes every target has one of, if the catalog declares them. */
  readonly scopes?: readonly Scope[]
  /**
   * Variants of a preset ordered by density.
   *
   * With the path of a GIF or WebP source of a preset that preserves animation, they are the variants that keep it.
   */
  variants(preset: Name, path?: string): readonly RenditionVariant[]
  /**
   * Variant of a preset at a density, `1` by default, chosen by the source path like in `variants()`.
   *
   * @throws {RangeError} When the preset does not declare the density.
   */
  variant(preset: Name, density?: number, path?: string): RenditionVariant
  /**
   * Extensions of source files a preset shows as they are instead of rendered.
   *
   * @throws {RangeError} When the preset is unknown.
   */
  originals(preset: Name): readonly string[]
  /**
   * Whether a preset shows a source as it is instead of rendered, judged by the extension of its path.
   *
   * @throws {RangeError} When the preset is unknown.
   */
  isOriginal(preset: Name, path: string): boolean
  /** Every variant of every preset, one per hash. */
  readonly allVariants: readonly RenditionVariant[]
  /** Variant with a recipe hash, if the catalog has one. */
  findVariant(hash: string): RenditionVariant | undefined
  /**
   * Root-relative URL of a rendition.
   *
   * @throws {RangeError} When the preset is unknown or does not declare the density, the scope is not one the catalog declares, or the scope or path is unsafe to put into the URL.
   */
  url(preset: Name, target: RenditionTarget<Scope>, density?: number): string
  /**
   * `srcset` attribute value listing every density of a preset.
   *
   * @throws {RangeError} When the preset is unknown, the scope is not one the catalog declares, or the scope or path is unsafe to put into the URL.
   */
  srcset(preset: Name, target: RenditionTarget<Scope>): string
}

// The constraints are structural, because a catalog with scopes is not assignable to `Catalog<string, string>`.

/** Preset names of a catalog, such as `PresetName<typeof catalog>`. */
export type PresetName<C extends Pick<Catalog, "presets">> = C["presets"][number]

/** Scopes a catalog declares, or `string` when it declares none. */
export type ScopeName<C extends Pick<Catalog, "scopes">> = NonNullable<C["scopes"]>[number]

/**
 * Validates a catalog and computes the recipe and hash of every preset density.
 *
 * Preset names are only labels: renaming a preset keeps its hashes and thus its stored renditions.
 *
 * @throws {RangeError} When the catalog is invalid.
 */
export function defineCatalog<const Name extends string, const Scope extends string = string>(
  // Scopes given as type arguments must be declared too, or the catalog would not check them.
  definition: CatalogDefinition<Name, Scope> &
    (string extends Scope ? unknown : { scopes: readonly Scope[] }),
): Catalog<Name, Scope> {
  const basePath = definition.basePath ?? DEFAULT_BASE_PATH
  assertBasePath(basePath)
  const scopes = definition.scopes && Object.freeze([...definition.scopes])
  if (scopes) {
    if (scopes.length === 0) {
      throw new RangeError("Catalog scopes must not be empty.")
    }
    for (const [index, scope] of scopes.entries()) {
      if (!isSafeScope(scope)) {
        throw new RangeError(`Invalid rendition scope "${scope}".`)
      }
      if (scopes.indexOf(scope) !== index) {
        throw new RangeError(`Duplicate rendition scope "${scope}".`)
      }
    }
  }
  const pipeline = definition.pipelineVersion ?? 1
  const presets = Object.freeze(Object.keys(definition.presets) as Name[])

  // The catalog and its variants are frozen, so a recipe keeps matching the hash computed for it here.
  const presetsByName = new Map<
    Name,
    {
      variants: readonly RenditionVariant[]
      originals: readonly string[]
      animatedVariants?: readonly RenditionVariant[]
    }
  >()
  const variantsByHash = new Map<string, RenditionVariant>()
  for (const preset of presets) {
    if (!/^[\w-]{1,64}$/.test(preset)) {
      throw new RangeError(`Invalid preset name "${preset}".`)
    }
    const {
      densities = [1],
      originals = [],
      animation = "first-frame",
      ...options
    } = {
      ...definition.defaults,
      ...omitUndefined(definition.presets[preset]),
    }
    if (densities.length === 0 || new Set(densities).size !== densities.length) {
      throw new RangeError(`Preset "${preset}" must declare unique densities.`)
    }
    // The `src` and the size of an image come from density 1.
    if (!densities.includes(1)) {
      throw new RangeError(`Preset "${preset}" must include density 1.`)
    }
    if (!originals.every(extension => /^[\da-z]+$/.test(extension))) {
      throw new RangeError(
        `Preset "${preset}" must list original extensions in lowercase and without the dot.`,
      )
    }

    const sortedDensities = [...densities].sort((a, b) => a - b)
    const createVariants = (variantOptions: RenditionOptions, animation: RenditionAnimation) =>
      Object.freeze(
        sortedDensities.map((density): RenditionVariant => {
          const recipe = wrapRangeError(`preset "${preset}"`, () =>
            normalizeRecipe({
              options: variantOptions,
              density,
              pipeline,
              policy: definition.sources,
              animation,
            }),
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
    const variants = createVariants(options, "first-frame")
    // Quality and effort of another format would not suit WebP, so WebP defaults replace them.
    // The animation is passed on even when it is not `preserve`, so an invalid value fails here.
    const animatedVariants =
      animation === "first-frame"
        ? undefined
        : createVariants(
            options.format === "webp"
              ? options
              : { ...options, format: "webp", quality: undefined, effort: undefined },
            animation,
          )
    presetsByName.set(preset, {
      variants,
      originals: Object.freeze([...originals]),
      animatedVariants,
    })
    for (const variant of [...variants, ...(animatedVariants ?? [])]) {
      const known = variantsByHash.get(variant.hash)
      // Presets with equal recipes share renditions, so either variant describes the hash correctly, while different recipes must not share them.
      if (known && serializeRecipe(known.recipe) !== serializeRecipe(variant.recipe)) {
        throw new RangeError(
          `Variants "${known.label}" and "${variant.label}" have different recipes of the same hash; change pipelineVersion to change every hash.`,
        )
      }
      if (!known) {
        variantsByHash.set(variant.hash, variant)
      }
    }
  }

  function getPreset(preset: Name) {
    const found = presetsByName.get(preset)
    if (!found) {
      throw new RangeError(`Unknown rendition preset "${preset}".`)
    }
    return found
  }

  function variants(preset: Name, path?: string) {
    const { variants, animatedVariants } = getPreset(preset)
    return animatedVariants && path !== undefined && hasExtension(path, ANIMATED_EXTENSIONS)
      ? animatedVariants
      : variants
  }

  function variant(preset: Name, density = 1, path?: string) {
    const found = variants(preset, path).find(variant => variant.density === density)
    if (!found) {
      throw new RangeError(`Preset "${preset}" has no density ${density}.`)
    }
    return found
  }

  function formatVariantUrl(
    { label, hash, recipe }: RenditionVariant,
    { scope, path }: RenditionTarget,
  ) {
    assertDeclaredScope(scopes, scope)
    return formatRenditionPath(basePath, { scope, label, hash, format: recipe.format, path })
  }

  return Object.freeze<Catalog<Name, Scope>>({
    basePath,
    presets,
    scopes,
    variants,
    variant,
    originals: preset => getPreset(preset).originals,
    isOriginal: (preset, path) => hasExtension(path, getPreset(preset).originals),
    allVariants: Object.freeze([...variantsByHash.values()]),
    findVariant: hash => variantsByHash.get(hash),
    url: (preset, target, density) =>
      formatVariantUrl(variant(preset, density, target.path), target),
    srcset: (preset, target) =>
      variants(preset, target.path)
        .map(variant => `${formatVariantUrl(variant, target)} ${variant.density}x`)
        .join(", "),
  })
}

/** Whether the extension of a path is in a list of lowercase extensions. */
function hasExtension(path: string, extensions: readonly string[]) {
  // The extension is taken from the last segment, so a dot in a folder name is not one.
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase()
  return extension !== undefined && extensions.includes(extension)
}

function omitUndefined<T extends object>(value: T): Partial<T> {
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
