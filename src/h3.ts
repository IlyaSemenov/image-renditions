import { defineEventHandler, type EventHandler, type H3Event } from "h3"

import {
  createRenditionHandler,
  type RenditionHandlerOptions,
  type RenditionRequest,
} from "./server/handler"

/** Source of the application context of a request. */
interface ContextOptions<Context> {
  /** Derives the application context, such as a tenant, from the request event. */
  getContext(event: H3Event): Context | Promise<Context>
}

/**
 * Options of {@link defineRenditionEventHandler}.
 *
 * `getContext` may be omitted when the server accepts an `undefined` context.
 */
export type RenditionEventHandlerOptions<Context> = RenditionHandlerOptions<Context> &
  (undefined extends Context ? Partial<ContextOptions<Context>> : ContextOptions<Context>)

/** Event fields of h3 v1 (`method`, `path`) and h3 v2 (`req`, `url`); h3 v1 also has a Node `req` with an optional method. */
interface EventLike {
  method?: string
  path?: string
  req?: { method?: string }
  url?: URL
}

/**
 * Defines an h3 event handler serving rendition URLs, for h3 v1 and v2.
 *
 * Mount it at the catalog base path with a catch-all route, such as `/_renditions/**`.
 */
export function defineRenditionEventHandler<Context>(
  options: RenditionEventHandlerOptions<Context>,
): EventHandler {
  // The declared return type keeps declarations free of handler types that exist in one h3 major version only.
  const handler = createRenditionHandler(options)
  // The options type allows omitting `getContext` only when the context accepts `undefined`.
  const getContext = (options as Partial<ContextOptions<Context>>).getContext
  return defineEventHandler(async event =>
    handler(readRequest(event), (await getContext?.(event)) as Context),
  )
}

function readRequest(event: EventLike): RenditionRequest {
  // Only h3 v2 has `url`; it keeps the wire encoding of escapes that matter in `url.pathname`, which is what the URL parser expects.
  if (event.url instanceof URL) {
    return { method: event.req!.method!, path: event.url.pathname + event.url.search }
  }
  return { method: event.method!, path: event.path! }
}
