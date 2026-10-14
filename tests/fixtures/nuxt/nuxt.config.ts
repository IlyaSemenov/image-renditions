export default defineNuxtConfig({
  modules: ["image-renditions/nuxt"],
  renditions: {
    catalog: "#shared/renditions",
    // Outside `server/`, so only the module can mount it.
    handler: "~~/renditions/handler",
    defaultScope: "public",
    originalUrl: "~/original-url",
    imgAttrs: { loading: "lazy" },
  },
  runtimeConfig: { public: { originalsUrl: "/originals" } },
  devtools: { enabled: false },
  compatibilityDate: "2026-10-14",
})
