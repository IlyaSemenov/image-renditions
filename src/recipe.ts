import { assertInteger } from "./assert"

/** Output encoding of a rendition. */
export type RenditionFormat = "avif" | "webp" | "jpeg" | "png"

/**
 * How a resized source fills a box of both `width` and `height`.
 *
 * `cover` crops what overflows, `contain` letterboxes, and `fill` stretches.
 * `inside` and `outside` keep the aspect ratio, so one side of the output is smaller or larger than the box.
 */
export type RenditionFit = "cover" | "contain" | "fill" | "inside" | "outside"

/**
 * Which part of the source stays in view when `cover` crops it or `contain` letterboxes it.
 * `entropy` and `attention` choose the crop by content and apply to `cover` only.
 */
export type RenditionPosition =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "entropy"
  | "attention"

/**
 * How a rendition shows an animated source.
 *
 * `first-frame` renders its first frame as a still image, and `preserve` keeps the animation.
 */
export type RenditionAnimation = "first-frame" | "preserve"

/** How sources of a special kind are turned into a rendition. */
export interface SourcePolicy {
  /** `rasterize` renders vector sources at the resolution the output needs. */
  svg: "rasterize"
  /** `auto` applies the EXIF orientation before resizing; metadata never reaches the output. */
  orientation: "auto"
}

/** Transformation and encoding parameters, as written in a preset or in catalog defaults. */
export interface RenditionOptions {
  /** Target width in CSS pixels at density 1. */
  width?: number
  /** Target height in CSS pixels at density 1. */
  height?: number
  /** Applies only when both `width` and `height` are set; defaults to `cover`. */
  fit?: RenditionFit
  /** Applies only to `cover` and `contain`; defaults to `center`. */
  position?: RenditionPosition
  /** Allows upscaling sources smaller than the target box. */
  enlarge?: boolean
  /**
   * Hex color `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` for `contain` letterboxing and for flattening transparency into JPEG.
   * Letterboxing defaults to transparent and JPEG flattening to white.
   */
  background?: string
  /** Defaults to `avif`. */
  format?: RenditionFormat
  /** Encoder quality from 1 to 100; ignored by `png`. */
  quality?: number
  /** CPU effort of the `avif` (0–9) and `webp` (0–6) encoders. */
  effort?: number
}

/**
 * Fully explicit, canonical description of one rendition.
 *
 * Fields that cannot affect the output are omitted and applicable defaults are filled in, so equivalent options give equal recipes.
 */
export interface Recipe {
  /** Library-owned version of recipe semantics. */
  readonly engine: number
  /** Application-owned version that changes every recipe at once. */
  readonly pipeline: number
  readonly width?: number
  readonly height?: number
  readonly fit?: RenditionFit
  readonly position?: RenditionPosition
  readonly enlarge?: boolean
  readonly background?: string
  readonly format: RenditionFormat
  readonly quality?: number
  readonly effort?: number
  readonly svg: SourcePolicy["svg"]
  readonly animation: RenditionAnimation
  readonly orientation: SourcePolicy["orientation"]
}

/** File extension of each output format, used in rendition URLs and storage keys. */
export const formatExtensions: Record<RenditionFormat, string> = {
  avif: "avif",
  webp: "webp",
  jpeg: "jpg",
  png: "png",
}

/** MIME type of each output format. */
export const formatContentTypes: Record<RenditionFormat, string> = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
}

/** Library-owned recipe version; bumping it regenerates every rendition of every application. */
export const RECIPE_ENGINE_VERSION = 1

/** Upper bound of a rendition side in physical pixels; WebP cannot encode larger sides. */
export const MAX_DIMENSION = 16383

const defaultSourcePolicy: SourcePolicy = {
  svg: "rasterize",
  orientation: "auto",
}

const animations: readonly RenditionAnimation[] = ["first-frame", "preserve"]
const formats: readonly RenditionFormat[] = ["avif", "webp", "jpeg", "png"]
const fits: readonly RenditionFit[] = ["cover", "contain", "fill", "inside", "outside"]
const positions: readonly RenditionPosition[] = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "entropy",
  "attention",
]

/** Encoder quality defaults; `png` is lossless and has no quality. */
const defaultQuality: Record<Exclude<RenditionFormat, "png">, number> = {
  avif: 50,
  webp: 80,
  jpeg: 80,
}

/** Accepted effort range and default per format; formats without an entry ignore effort. */
const effortRange: Partial<Record<RenditionFormat, { min: number; max: number; default: number }>> =
  {
    avif: { min: 0, max: 9, default: 4 },
    webp: { min: 0, max: 6, default: 4 },
  }

/** Input of {@link normalizeRecipe}. */
export interface RecipeInput {
  options: RenditionOptions
  /** Multiplier from CSS pixels to physical pixels. */
  density?: number
  /** Application-owned pipeline version. */
  pipeline: number
  policy?: Partial<SourcePolicy>
  /** Defaults to `first-frame`. */
  animation?: RenditionAnimation
}

/**
 * Builds the canonical recipe for transformation options at a density.
 *
 * @throws {RangeError} When an option is out of range or inconsistent.
 */
export function normalizeRecipe({
  options,
  density = 1,
  pipeline,
  policy,
  animation = "first-frame",
}: RecipeInput): Recipe {
  assertInteger("pipeline", pipeline, 0, Number.MAX_SAFE_INTEGER)
  if (!(Number.isFinite(density) && density > 0)) {
    throw new RangeError(`Invalid density ${density}.`)
  }
  // Options are validated even where they cannot affect the output, so a typo never passes silently.
  const format = options.format ?? "avif"
  assertOneOf("format", format, formats)
  assertOneOf("animation", animation, animations)
  if (options.fit !== undefined) {
    assertOneOf("fit", options.fit, fits)
  }
  if (options.position !== undefined) {
    assertOneOf("position", options.position, positions)
  }
  const color = options.background === undefined ? undefined : normalizeColor(options.background)
  if (options.quality !== undefined) {
    assertInteger("quality", options.quality, 1, 100)
  }
  const range = effortRange[format]
  if (options.effort !== undefined) {
    // Formats without effort check it against the widest range instead of rejecting it, because catalog defaults apply to presets of every format.
    assertInteger("effort", options.effort, range?.min ?? 0, range?.max ?? 9)
  }

  const width = scaleDimension("width", options.width, density)
  const height = scaleDimension("height", options.height, density)
  const resized = width !== undefined || height !== undefined
  // With a single dimension the aspect ratio is kept, so fit and position cannot change the output.
  const fit = width !== undefined && height !== undefined ? (options.fit ?? "cover") : undefined
  const position = fit === "cover" || fit === "contain" ? (options.position ?? "center") : undefined
  if (fit === "contain" && (position === "entropy" || position === "attention")) {
    throw new RangeError(`Position "${position}" applies to the "cover" fit only.`)
  }
  const flattened = format === "jpeg"
  const background =
    fit === "contain" || flattened ? (color ?? (flattened ? "#ffffffff" : "#00000000")) : undefined

  return Object.freeze({
    engine: RECIPE_ENGINE_VERSION,
    pipeline,
    width,
    height,
    fit,
    position,
    enlarge: resized ? (options.enlarge ?? false) : undefined,
    background,
    format,
    quality: format === "png" ? undefined : (options.quality ?? defaultQuality[format]),
    effort: range ? (options.effort ?? range.default) : undefined,
    svg: resolvePolicyValue("svg", policy, ["rasterize"]),
    animation,
    orientation: resolvePolicyValue("orientation", policy, ["auto"]),
  })
}

/** Serializes a recipe deterministically: sorted keys, no undefined fields, no whitespace. */
export function serializeRecipe(recipe: Recipe): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(recipe)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  )
}

function resolvePolicyValue<K extends keyof SourcePolicy>(
  name: K,
  policy: Partial<SourcePolicy> | undefined,
  allowed: readonly SourcePolicy[K][],
) {
  const value = policy?.[name] ?? defaultSourcePolicy[name]
  assertOneOf(name, value, allowed)
  return value
}

function scaleDimension(name: string, value: number | undefined, density: number) {
  if (value === undefined) {
    return undefined
  }
  assertInteger(name, value, 1, MAX_DIMENSION)
  const scaled = Math.round(value * density)
  assertInteger(`${name} at density ${density}`, scaled, 1, MAX_DIMENSION)
  return scaled
}

/** Expands a hex color to lowercase `#rrggbbaa`, so equivalent spellings hash equally. */
function normalizeColor(color: string) {
  const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(color)
  if (!match) {
    throw new RangeError(`Invalid background color "${color}"; use a hex color.`)
  }
  const digits = match[1]!.toLowerCase()
  const full = digits.length <= 4 ? [...digits].map(digit => digit + digit).join("") : digits
  return `#${full.length === 6 ? `${full}ff` : full}`
}

function assertOneOf<T extends string>(name: string, value: T, allowed: readonly T[]) {
  if (!allowed.includes(value)) {
    throw new RangeError(`Invalid ${name} "${value}"; expected one of ${allowed.join(", ")}.`)
  }
}
