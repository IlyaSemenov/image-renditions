export default defineNuxtConfig({
  modules: ["image-renditions/nuxt"],
  renditions: {
    catalog: "#shared/renditions",
    // Outside `server/`, so only the module can mount it.
    handler: "~~/renditions/handler",
  },
  devtools: { enabled: false },
  compatibilityDate: "2026-10-14",
})
