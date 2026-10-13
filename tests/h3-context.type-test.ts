import { defineCatalog } from "image-renditions"
import { defineRenditionEventHandler } from "image-renditions/h3"
import type { RenditionServer } from "image-renditions/server"

const catalog = defineCatalog({ presets: { avatar: { width: 48 } } })
declare const contextFree: RenditionServer<unknown>
declare const tenantServer: RenditionServer<{ tenant: string }>

// A server that needs no context takes the handler without `getContext`.
export const contextFreeHandler = defineRenditionEventHandler({ catalog, server: contextFree })

// The context type is inferred from the server, which types the event and the returned context.
export const tenantHandler = defineRenditionEventHandler({
  catalog,
  server: tenantServer,
  getContext: event => ({ tenant: event.url.hostname }),
})

// @ts-expect-error A server that needs a context requires `getContext`.
export const missingContext = defineRenditionEventHandler({ catalog, server: tenantServer })
