import { fileURLToPath } from "node:url"

const resolveLayerPath = (path: string) =>
  fileURLToPath(new URL(`../nuxt/${path}`, import.meta.url))

export default defineNuxtConfig({
  extends: ["../nuxt"],
  // Aliases in the config of a layer resolve against the app, so the app points the options at the files of the layer.
  renditions: {
    catalog: resolveLayerPath("shared/renditions"),
    handler: resolveLayerPath("renditions/handler"),
    originalUrl: resolveLayerPath("app/original-url"),
  },
  compatibilityDate: "2026-10-14",
})
