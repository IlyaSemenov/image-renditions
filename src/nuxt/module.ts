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
import { isDeclaredScope } from "../scopes"

import { findRenditionAttr } from "./img-attrs"
import type { DefaultImgAttrs } from "./runtime"

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
  /** Scope for `<RenditionImg>` and `useRenditions()`, one of the catalog scopes if it declares them; their `scope` overrides it. */
  defaultScope?: string
  /**
   * Module whose default export is a composable returning a function that builds the URL of a source shown as it is, such as `~/renditions/original-url`.
   *
   * Required when a preset lists `originals`.
   * The function receives the scope, after `defaultScope`, and a safe logical path, which it must encode.
   */
  originalUrl?: string
  /** Attributes every `<RenditionImg>` renders, such as `{ loading: "lazy", decoding: "async" }`; attributes of an element override them. */
  imgAttrs?: DefaultImgAttrs
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

  async setup({ catalog: catalogModule, handler, defaultScope, originalUrl, imgAttrs }, nuxt) {
    if (!catalogModule) {
      throw new Error(
        "[image-renditions] Set `renditions.catalog` to the module exporting the catalog.",
      )
    }
    if (defaultScope !== undefined && !isSafeScope(defaultScope)) {
      throw new Error(`[image-renditions] Invalid default scope "${defaultScope}".`)
    }
    const renditionAttr = findRenditionAttr(imgAttrs)
    if (renditionAttr) {
      throw new Error(
        `[image-renditions] \`imgAttrs\` cannot set \`${renditionAttr}\`, which the rendition sets.`,
      )
    }
    const catalogPath = await resolvePath(catalogModule)
    // The catalog is loaded at build time to mount the handler at its base path, which also validates it before the app runs.
    const jiti = createJiti(nuxt.options.rootDir, { alias: nuxt.options.alias })
    const catalog = await jiti.import<Catalog>(catalogPath, { default: true })

    if (defaultScope !== undefined && !isDeclaredScope(catalog.scopes, defaultScope)) {
      throw new Error(
        `[image-renditions] The default scope "${defaultScope}" is not one of the catalog scopes.`,
      )
    }
    if (!originalUrl && catalog.presets.some(preset => catalog.originals(preset).length > 0)) {
      throw new Error(
        "[image-renditions] Set `renditions.originalUrl` to the module building URLs of originals, as a preset of the catalog lists `originals`.",
      )
    }
    const originalUrlPath = originalUrl && (await resolvePath(originalUrl))

    if (handler) {
      addServerHandler({ route: `${catalog.basePath}/**`, handler: await resolvePath(handler) })
    }

    // The generated module binds the runtime helpers to the catalog, so preset names are typed by the catalog itself.
    const template = addTemplate({
      filename: "image-renditions.ts",
      write: true,
      getContents: () =>
        [
          `import catalog from ${importSpecifier(catalogPath)}`,
          ...(originalUrlPath
            ? [`import useOriginalUrl from ${importSpecifier(originalUrlPath)}`]
            : []),
          `import { createRenditionHelpers } from "image-renditions/nuxt/runtime"`,
          "",
          `export const { useRenditions, RenditionImg } = createRenditionHelpers(catalog, {`,
          `  defaultScope: ${JSON.stringify(defaultScope)},`,
          `  useOriginalUrl: ${originalUrlPath ? "useOriginalUrl" : "undefined"},`,
          `  imgAttrs: ${JSON.stringify(imgAttrs)},`,
          `})`,
          "",
        ].join("\n"),
    })
    addImports({ name: "useRenditions", from: template.dst })
    addComponent({ name: "RenditionImg", export: "RenditionImg", filePath: template.dst })
  },
})

export default module

function importSpecifier(path: string) {
  return JSON.stringify(path.replace(/\.[cm]?[jt]s$/, ""))
}
