import { encodePath, isSafePath, isSafeScope } from "./path"
import { formatExtensions, type RenditionFormat } from "./recipe"

/** Version segment of the rendition URL format this library builds and parses. */
export const URL_FORMAT_VERSION = "v1"

/** Mount path of the rendition handler unless a catalog sets another one. */
export const DEFAULT_BASE_PATH = "/_renditions"

/** Parts of a rendition URL. */
export interface RenditionAddress {
  /** Application-defined space the logical path belongs to, such as a tenant. */
  scope?: string
  /** Human-readable variant name; the server ignores it and resolves the recipe by `hash`. */
  label: string
  hash: string
  /** Output format, which also lets a server locate a rendition whose recipe it no longer knows. */
  format: RenditionFormat
  /** Logical source path inside the scope. */
  path: string
}

/**
 * Formats the path of a rendition URL: `<basePath>/v1/[<scope>/]<label>.<hash>.<extension>/<path>`.
 *
 * @throws {RangeError} When a part is unsafe to put into the URL.
 */
export function formatRenditionPath(
  basePath: string,
  { scope, label, hash, format, path }: RenditionAddress,
): string {
  assertBasePath(basePath)
  if (scope !== undefined && !isSafeScope(scope)) {
    throw new RangeError(`Invalid rendition scope "${scope}".`)
  }
  const extension = formatExtensions[format]
  if (!isSafeLabel(label) || !isHash(hash) || !extension) {
    throw new RangeError(`Invalid rendition variant "${label}.${hash}.${extension ?? format}".`)
  }
  if (!isSafePath(path)) {
    throw new RangeError(`Unsafe rendition source path "${path}".`)
  }
  const scopePrefix = scope === undefined ? "" : `${scope}/`
  return `${basePath}/${URL_FORMAT_VERSION}/${scopePrefix}${label}.${hash}.${extension}/${encodePath(path)}`
}

/**
 * Parses the path of a rendition URL, ignoring any query string.
 *
 * Returns `undefined` for a path outside `basePath`, another URL format version, or malformed or unsafe parts.
 */
export function parseRenditionPath(basePath: string, url: string): RenditionAddress | undefined {
  const prefix = `${basePath}/${URL_FORMAT_VERSION}/`
  const pathname = url.split("?", 1)[0]!
  if (!pathname.startsWith(prefix)) {
    return undefined
  }
  const parts = pathname.slice(prefix.length).split("/")
  // A scope has no dots and a variant always has two, so the first part tells whether the scope is present.
  const scope = isSafeScope(parts[0]!) ? parts.shift() : undefined
  const [variant, ...encodedSegments] = parts
  if (!variant) {
    return undefined
  }
  // The label may contain dots of fractional densities, so the hash and the extension are taken from the end.
  const match = /^(.+)\.([^.]+)\.([^.]+)$/.exec(variant)
  const [, label = "", hash = "", extension] = match ?? []
  const format = formats.find(format => formatExtensions[format] === extension)
  if (!isSafeLabel(label) || !isHash(hash) || !format) {
    return undefined
  }
  const segments = encodedSegments.map(decodeSegment)
  // A decoded slash would turn one segment into several, so the URL would not address one path unambiguously.
  if (segments.some(segment => segment === undefined || segment.includes("/"))) {
    return undefined
  }
  const path = segments.join("/")
  return isSafePath(path) ? { scope, label, hash, format, path } : undefined
}

/**
 * Checks that a base path is absolute, has no trailing slash and needs no URL encoding.
 *
 * @throws {RangeError} When the base path is invalid.
 */
export function assertBasePath(basePath: string): void {
  if (!/^(?:\/[\w.~-]+)+$/.test(basePath)) {
    throw new RangeError(`Invalid rendition base path "${basePath}".`)
  }
}

const formats = Object.keys(formatExtensions) as RenditionFormat[]

function isSafeLabel(label: string) {
  return /^[\w@.-]{1,64}$/.test(label)
}

/**
 * Checks that a recipe hash is 1 to 64 ASCII letters, digits, `_` or `-`, which need no encoding in a URL or a storage key.
 *
 * The grammar does not fix the format of hashes, so a hash the catalog cannot produce is looked up as a published rendition instead of making the URL malformed.
 */
function isHash(hash: string) {
  return /^[\w-]{1,64}$/.test(hash)
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}
