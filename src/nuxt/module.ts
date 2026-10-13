import { createJiti } from "jiti"
import {
  addComponent,
  addImports,
  addServerHandler,
  addTemplate,
  defineNuxtModule,
  resolvePath,
} from "nuxt/kit"
import type { NuxtModule } from "nuxt/schema"

import type { Catalog } from "../catalog"
import { isSafeScope } from "../path"

/** Options of the `image-renditions/nuxt` module, under the `renditions` key of the Nuxt config. */
export interface ModuleOptions {
  /**
   * Module whose default export is the catalog, such as `#shared/renditions`.
   *
   * It is bundled into both the client and the server, so it must import only the browser-safe `image-renditions` entry.
   */
  catalog?: string
  /** Module whose default export is the h3 event handler of renditions, mounted at the catalog base path. */
  handler?: string
  /** Scope for `<RenditionImg>` and `useRenditions()`; their `scope` overrides it. */
  defaultScope?: string
}

/**
 * Nuxt module that mounts the rendition handler and provides `useRenditions()` and `<RenditionImg>` typed by the catalog.
 */
// The explicit type keeps declarations referring to the `nuxt` peer instead of inlining `@nuxt/schema`.
const module: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: "image-renditions",
    configKey: "renditions",
  },

  async setup({ catalog: catalogModule, handler, defaultScope }, nuxt) {
    if (!catalogModule) {
      throw new Error(
        "[image-renditions] Set `renditions.catalog` to the module exporting the catalog.",
      )
    }
    if (defaultScope !== undefined && !isSafeScope(defaultScope)) {
      throw new Error(`[image-renditions] Invalid default scope "${defaultScope}".`)
    }
    const catalogPath = await resolvePath(catalogModule)
    // The catalog is loaded at build time to mount the handler at its base path, which also validates it before the app runs.
    const jiti = createJiti(nuxt.options.rootDir, { alias: nuxt.options.alias })
    const catalog = await jiti.import<Catalog>(catalogPath, { default: true })

    if (handler) {
      addServerHandler({ route: `${catalog.basePath}/**`, handler: await resolvePath(handler) })
    }

    // The generated module binds the runtime helpers to the catalog, so preset names are typed by the catalog itself.
    const template = addTemplate({
      filename: "image-renditions.ts",
      write: true,
      getContents: () =>
        [
          `import catalog from ${JSON.stringify(catalogPath.replace(/\.[cm]?[jt]s$/, ""))}`,
          `import { createRenditionHelpers } from "image-renditions/nuxt/runtime"`,
          "",
          `export const { useRenditions, RenditionImg } = createRenditionHelpers(catalog, ${JSON.stringify(defaultScope)})`,
          "",
        ].join("\n"),
    })
    addImports({ name: "useRenditions", from: template.dst })
    addComponent({ name: "RenditionImg", export: "RenditionImg", filePath: template.dst })
  },
})

export default module
