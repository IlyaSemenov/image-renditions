import type { Catalog } from "./catalog"
import { encodePath, isSafePath, isSafeScope } from "./path"
import { formatExtensions, type RenditionFormat } from "./recipe"
import { assertDeclaredScope } from "./scopes"

/** Version segment of the rendition URL format this library builds and parses. */
const URL_FORMAT_VERSION = "v1"

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
 * Formats the path of a rendition URL of a catalog: `<basePath>/v1/[<scope>/]<path>/<label>.<hash>.<extension>`.
 *
 * The URL has a scope exactly when the catalog declares scopes.
 *
 * @throws {RangeError} When a part is unsafe to put into the URL, or the scope is missing, not declared, or given to a catalog without scopes.
 */
export function formatRenditionPath(
  { basePath, scopes }: Pick<Catalog, "basePath" | "scopes">,
  { scope, label, hash, format, path }: RenditionAddress,
): string {
  assertBasePath(basePath)
  assertDeclaredScope(scopes, scope)
  assertSafeTarget(scope, path)
  const extension = formatExtensions[format]
  if (!isSafeLabel(label) || !isHash(hash) || !extension) {
    throw new RangeError(`Invalid rendition variant "${label}.${hash}.${extension ?? format}".`)
  }
  return joinRenditionPath(basePath, { scope, label, hash, format }, encodePath(path))
}

/**
 * Checks that a scope and a source path are safe to put into a rendition URL.
 *
 * @throws {RangeError} When the scope or the path is unsafe.
 */
export function assertSafeTarget(scope: string | undefined, path: string): void {
  if (scope !== undefined && !isSafeScope(scope)) {
    throw new RangeError(`Invalid rendition scope "${scope}".`)
  }
  if (!isSafePath(path)) {
    throw new RangeError(`Unsafe rendition source path "${path}".`)
  }
}

/**
 * Joins the parts of a rendition URL path without checking them, with the source path already encoded.
 *
 * It serves parts checked once for several URLs, such as the variants of a catalog for one target.
 */
export function joinRenditionPath(
  basePath: string,
  { scope, label, hash, format }: Omit<RenditionAddress, "path">,
  encodedPath: string,
): string {
  const scopePrefix = scope === undefined ? "" : `${scope}/`
  return `${basePath}/${URL_FORMAT_VERSION}/${scopePrefix}${encodedPath}/${label}.${hash}.${formatExtensions[format]}`
}

/**
 * Parses the path of a rendition URL of a catalog, ignoring any query string.
 *
 * The URL has a scope exactly when the catalog declares scopes; whether the catalog declares this scope is left to the caller.
 * Returns `undefined` for a path outside the base path of the catalog, another URL format version, or malformed or unsafe parts.
 */
export function parseRenditionPath(
  { basePath, scopes }: Pick<Catalog, "basePath" | "scopes">,
  url: string,
): RenditionAddress | undefined {
  const prefix = `${basePath}/${URL_FORMAT_VERSION}/`
  const pathname = url.split("?", 1)[0]!
  if (!pathname.startsWith(prefix)) {
    return undefined
  }
  const encodedSegments = pathname.slice(prefix.length).split("/")
  // A scope looks like any segment of a path, so only the catalog tells whether the URL has one.
  const scope = scopes ? encodedSegments.shift()! : undefined
  const variant = encodedSegments.pop()
  if ((scope !== undefined && !isSafeScope(scope)) || !variant) {
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

/** Checks that a variant label is 1 to 64 characters that need no encoding in a URL. */
export function isSafeLabel(label: string): boolean {
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
