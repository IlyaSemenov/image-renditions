import { useRuntimeConfig } from "nuxt/app"
import { defineComponent, h, type PropType } from "vue"

import type { Catalog } from "../catalog"
import { isSafePath } from "../path"

/** Attributes of an `img` element showing a rendition. */
export interface RenditionImgAttrs {
  /** Absent for an unsafe path. */
  src?: string
  srcset?: string
  width?: number
  height?: number
}

/** Options of a rendition URL. */
export interface RenditionUrlOptions {
  /** Scope of the path; defaults to the module's `defaultScope`. */
  scope?: string
  /** Density of the variant; defaults to `1`. */
  density?: number
}

/**
 * Binds `useRenditions()` and `<RenditionImg>` to a catalog.
 *
 * The Nuxt module calls it in a generated module; applications use the generated helpers.
 */
export function createRenditionHelpers<Name extends string>(
  catalog: Catalog<Name>,
  defaultScope?: string,
) {
  /** Builds rendition URLs below the application base URL. */
  function useRenditions() {
    const base = useRuntimeConfig().app.baseURL.replace(/\/$/, "")

    function formatUrl(preset: Name, path: string, { scope, density }: RenditionUrlOptions) {
      return base + catalog.url(preset, { scope: scope ?? defaultScope, path }, density)
    }

    function formatSrcset(
      preset: Name,
      path: string,
      { scope }: Pick<RenditionUrlOptions, "scope">,
    ) {
      return catalog
        .variants(preset)
        .map(({ density }) => `${formatUrl(preset, path, { scope, density })} ${density}x`)
        .join(", ")
    }

    /**
     * URL of a rendition of a logical path.
     *
     * Returns `undefined` for an unsafe path, such as one with a `..` segment, so stored data never breaks rendering.
     *
     * @throws {RangeError} When the preset is unknown or does not declare the density, or the scope is invalid.
     */
    function url(
      preset: Name,
      path: string,
      options: RenditionUrlOptions = {},
    ): string | undefined {
      return isSafePath(path) ? formatUrl(preset, path, options) : undefined
    }

    /**
     * `srcset` attribute value listing every density of a preset.
     *
     * Returns `undefined` for an unsafe path, like `url()`.
     *
     * @throws {RangeError} When the preset is unknown, or the scope is invalid.
     */
    function srcset(
      preset: Name,
      path: string,
      options: Pick<RenditionUrlOptions, "scope"> = {},
    ): string | undefined {
      return isSafePath(path) ? formatSrcset(preset, path, options) : undefined
    }

    /**
     * Attributes of an `img` element showing every density of a preset.
     *
     * `width` and `height` are set only when the output always has the size of the preset box, so they never distort the image.
     * A source that is already a URL, such as a `blob:`, `data:` or `https:` one, is returned unchanged as `src`.
     * An unsafe path, such as one with a `..` segment, yields no `src`, so stored data never breaks rendering.
     */
    function attrs(
      preset: Name,
      path: string,
      options: Pick<RenditionUrlOptions, "scope"> = {},
    ): RenditionImgAttrs {
      if (/^(?:[a-z][\d+.a-z-]*:|\/\/)/i.test(path)) {
        return { src: path }
      }
      if (!isSafePath(path)) {
        return {}
      }
      const { recipe } = catalog.variant(preset)
      // Without enlargement a small source keeps its own size under `cover` and `fill`, while `contain` always pads the box.
      const boxed =
        recipe.fit === "contain" ||
        ((recipe.fit === "cover" || recipe.fit === "fill") && recipe.enlarge)
      return {
        src: formatUrl(preset, path, options),
        srcset:
          catalog.variants(preset).length > 1 ? formatSrcset(preset, path, options) : undefined,
        width: boxed ? recipe.width : undefined,
        height: boxed ? recipe.height : undefined,
      }
    }

    return { url, srcset, attrs }
  }

  /**
   * `img` element showing a rendition of a logical path.
   *
   * A source that is already a URL is shown unchanged.
   */
  const RenditionImg = defineComponent({
    name: "RenditionImg",
    props: {
      // A generic preset name type does not overlap `StringConstructor`, so the prop type is narrowed through `unknown`.
      preset: { type: String as unknown as PropType<Name>, required: true },
      /** Logical source path inside the scope, or a URL shown as is. */
      src: { type: String, required: true },
      scope: { type: String, default: undefined },
    },
    setup(props) {
      const renditions = useRenditions()
      return () => h("img", renditions.attrs(props.preset, props.src, { scope: props.scope }))
    },
  })

  return { useRenditions, RenditionImg }
}
