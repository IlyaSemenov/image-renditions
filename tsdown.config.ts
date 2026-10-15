import { defineConfig } from "tsdown"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    server: "src/server/index.ts",
    s3: "src/stores/s3.ts",
    fs: "src/stores/fs.ts",
    redis: "src/redis/index.ts",
    sharp: "src/processors/sharp/index.ts",
    h3: "src/h3.ts",
    nuxt: "src/nuxt/module.ts",
    // The generated Nuxt module imports the runtime by package path, so it is a public entry.
    "nuxt/runtime": "src/nuxt/runtime.ts",
  },
  format: "esm",
  dts: true,
  exports: true,
  publint: true,
  attw: {
    profile: "esm-only",
  },
})
