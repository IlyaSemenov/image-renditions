import { createApp, createRouter } from "h3"
import { defineCatalog } from "image-renditions"
import { defineRenditionEventHandler } from "image-renditions/h3"
import type { RenditionServer } from "image-renditions/server"

declare const server: RenditionServer<{ path: string }>

// The handler mounts on an h3 v1 router as is, and the context reads an h3 v1 event.
export const app = createApp().use(
  createRouter().use(
    "/_renditions/**",
    defineRenditionEventHandler({
      catalog: defineCatalog({ presets: { avatar: { width: 48 } } }),
      server,
      getContext: event => ({ path: event.path }),
    }),
  ),
)
