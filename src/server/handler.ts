import type { Catalog } from "../catalog"
import { parseRenditionPath, type RenditionAddress } from "../url"

import { RenditionError, type RenditionFailureReason } from "./error"
import type { RenditionServer } from "./server"

/** HTTP request fields a rendition handler reads. */
export interface RenditionRequest {
  method: string
  /** Request path in its wire encoding, with an optional query string. */
  path: string
}

/** Failed rendition request, as passed to a failure policy. */
export interface RenditionFailure<Context> {
  reason: RenditionFailureReason
  error: RenditionError
  /** Parsed rendition URL, absent when the URL is malformed. */
  address?: RenditionAddress
  context: Context
}

/** Options of {@link createRenditionHandler}. */
export interface RenditionHandlerOptions<Context> {
  /** Catalog whose recipes are generated on demand. */
  catalog: Catalog
  server: RenditionServer<Context>
  /**
   * Builds the response to a failure; `undefined` keeps the default response with a status of the reason.
   *
   * The handler sets `Cache-Control: no-store` on every failure response, including fallbacks such as redirects to the original.
   */
  onFailure?(
    failure: RenditionFailure<Context>,
  ): Response | undefined | Promise<Response | undefined>
  /**
   * `Cache-Control` of redirects to published renditions; `public, max-age=86400` by default.
   *
   * Keep it moderate: the target URL depends on storage configuration, and a cached redirect cannot be revoked.
   * Use `no-store` when the context depends on cookies or a session, because caches reuse a redirect for every request of its URL.
   */
  redirectCacheControl?: string
}

/**
 * Serves rendition URLs by redirecting to published renditions.
 *
 * `getContext` returns the application context, such as a tenant.
 * The handler calls it at most once, and only for a request it passes to the server or a failure it passes to `onFailure`, so unsupported methods and malformed URLs skip a lookup.
 * Its failures propagate unchanged, without `onFailure`.
 */
export type RenditionHandler<Context> = (
  request: RenditionRequest,
  getContext: () => Context | Promise<Context>,
) => Promise<Response>

const failureStatus: Record<RenditionFailureReason, number> = {
  "invalid-request": 404,
  "unknown-recipe": 404,
  "source-not-found": 404,
  "unsupported-source": 422,
  "source-too-large": 422,
  "source-error": 502,
  "processing-failed": 500,
  "storage-error": 502,
  overloaded: 503,
}

/**
 * Creates a framework-independent rendition handler.
 *
 * A hash from the catalog is rendered on demand.
 * An unknown hash is served only when the readiness indexes know its rendition, so arbitrary hashes cost no storage calls.
 */
export function createRenditionHandler<Context>({
  catalog,
  server,
  onFailure,
  redirectCacheControl = "public, max-age=86400",
}: RenditionHandlerOptions<Context>): RenditionHandler<Context> {
  async function fail(
    error: RenditionError,
    address: RenditionAddress | undefined,
    getContext: () => Context | Promise<Context>,
  ) {
    const response =
      (onFailure &&
        (await onFailure({ reason: error.reason, error, address, context: await getContext() }))) ??
      new Response(error.reason, {
        status: failureStatus[error.reason],
        headers: {
          "content-type": "text/plain",
          ...(error.reason === "overloaded" && { "retry-after": "1" }),
        },
      })
    // Responses such as `Response.redirect()` have immutable headers, so the response is rebuilt.
    const headers = new Headers(response.headers)
    headers.set("cache-control", "no-store")
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  return async ({ method, path }, getContext) => {
    if (method !== "GET" && method !== "HEAD") {
      return new Response(null, {
        status: 405,
        headers: { allow: "GET, HEAD", "cache-control": "no-store" },
      })
    }
    const address = parseRenditionPath(catalog.basePath, path)
    if (!address) {
      const error = new RenditionError("invalid-request", "Malformed rendition URL.")
      return fail(error, undefined, getContext)
    }
    const variant = catalog.findVariant(address.hash)
    // Another extension for a known hash would give one rendition several URLs.
    if (variant && variant.recipe.format !== address.format) {
      const error = new RenditionError(
        "invalid-request",
        "The extension does not match the recipe format.",
      )
      return fail(error, address, getContext)
    }
    // Resolved outside the try block, so its failures propagate without `onFailure`.
    const context = await getContext()
    const target = { scope: address.scope, path: address.path }
    try {
      const rendition = variant
        ? await server.ensure(variant.recipe, target, context)
        : await server.findPublished(address.hash, address.format, target, context)
      if (!rendition) {
        throw new RenditionError("unknown-recipe", `Unknown recipe ${address.hash}.`)
      }
      return new Response(null, {
        status: 307,
        headers: { location: rendition.url, "cache-control": redirectCacheControl },
      })
    } catch (error) {
      if (error instanceof RenditionError) {
        return fail(error, address, () => context)
      }
      throw error
    }
  }
}
