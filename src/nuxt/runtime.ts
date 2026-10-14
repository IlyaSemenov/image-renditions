import { useRuntimeConfig } from "nuxt/app"
import { defineComponent, h, type PropType } from "vue"

import type { Catalog, RenditionTarget } from "../catalog"
import { isSafePath, isSafeScope } from "../path"

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

/** Options of {@link createRenditionHelpers}. */
export interface RenditionHelpersOptions {
  /** Scope of calls that set none. */
  defaultScope?: string
  /**
   * Composable returning a function that builds the URL of a source shown as it is; required when a preset lists `originals`.
   *
   * The function receives a safe logical path, which it must encode.
   */
  useOriginalUrl?: () => (target: RenditionTarget) => string
}

/**
 * Binds `useRenditions()` and `<RenditionImg>` to a catalog.
 *
 * The Nuxt module calls it in a generated module; applications use the generated helpers.
 *
 * @throws {Error} When a preset lists `originals` and `useOriginalUrl` is missing.
 */
export function createRenditionHelpers<Name extends string>(
  catalog: Catalog<Name>,
  { defaultScope, useOriginalUrl }: RenditionHelpersOptions = {},
) {
  if (!useOriginalUrl && catalog.presets.some(preset => catalog.originals(preset).length > 0)) {
    throw new Error(
      "[image-renditions] Pass `useOriginalUrl`, as a preset of the catalog lists `originals`.",
    )
  }

  /** Builds rendition URLs below the application base URL. */
  function useRenditions() {
    const base = useRuntimeConfig().app.baseURL.replace(/\/$/, "")
    // Called on every `useRenditions()`, so the function it returns captures the composables of the current app and request.
    // It is defined whenever a preset lists originals, as checked above.
    const originalUrl = useOriginalUrl?.()

    /**
     * Target of a path in the scope of a call, or `undefined` for an unsafe path.
     *
     * The scope is checked here because the URL of an original does not go through the rendition URL builder, which checks it too.
     */
    function resolveTarget(path: string, scope: string | undefined): RenditionTarget | undefined {
      if (!isSafePath(path)) {
        return undefined
      }
      const resolved = scope ?? defaultScope
      if (resolved !== undefined && !isSafeScope(resolved)) {
        throw new RangeError(`Invalid rendition scope "${resolved}".`)
      }
      return { scope: resolved, path }
    }

    function formatUrl(preset: Name, target: RenditionTarget, density?: number) {
      return base + catalog.url(preset, target, density)
    }

    function formatSrcset(preset: Name, target: RenditionTarget) {
      return catalog
        .variants(preset)
        .map(({ density }) => `${formatUrl(preset, target, density)} ${density}x`)
        .join(", ")
    }

    /**
     * URL of a rendition of a logical path, or of the source itself at every declared density when the preset lists its extension in `originals`.
     *
     * Returns `undefined` for an unsafe path, such as one with a `..` segment, so stored data never breaks rendering.
     *
     * @throws {RangeError} When the preset is unknown or does not declare the density, or the scope is invalid.
     */
    function url(
      preset: Name,
      path: string,
      { scope, density }: RenditionUrlOptions = {},
    ): string | undefined {
      const target = resolveTarget(path, scope)
      if (!target) {
        return undefined
      }
      if (catalog.isOriginal(preset, path)) {
        // The density is checked for originals too, so a call fails the same way whatever the source.
        catalog.variant(preset, density)
        return originalUrl!(target)
      }
      return formatUrl(preset, target, density)
    }

    /**
     * `srcset` attribute value listing every density of a preset.
     *
     * Returns `undefined` for an unsafe path, like `url()`, and for a source shown as it is, which has no densities.
     *
     * @throws {RangeError} When the preset is unknown, or the scope is invalid.
     */
    function srcset(
      preset: Name,
      path: string,
      { scope }: Pick<RenditionUrlOptions, "scope"> = {},
    ): string | undefined {
      const target = resolveTarget(path, scope)
      return target && !catalog.isOriginal(preset, path) ? formatSrcset(preset, target) : undefined
    }

    /**
     * Attributes of an `img` element showing every density of a preset.
     *
     * `width` and `height` are set only when the output always has the size of the preset box, so they never distort the image.
     * A source that is already a URL, such as a `blob:`, `data:` or `https:` one, is returned unchanged as `src`.
     * A source whose extension the preset lists in `originals` gets only the `src` of the source itself.
     * An unsafe path, such as one with a `..` segment, yields no `src`, so stored data never breaks rendering.
     */
    function attrs(
      preset: Name,
      path: string,
      { scope }: Pick<RenditionUrlOptions, "scope"> = {},
    ): RenditionImgAttrs {
      if (/^(?:[a-z][\d+.a-z-]*:|\/\/)/i.test(path)) {
        return { src: path }
      }
      const target = resolveTarget(path, scope)
      if (!target) {
        return {}
      }
      if (catalog.isOriginal(preset, path)) {
        // The box of the preset would distort a source of another aspect ratio, so the source keeps its own size.
        return { src: originalUrl!(target) }
      }
      const { recipe } = catalog.variant(preset)
      // Without enlargement a small source keeps its own size under `cover` and `fill`, while `contain` always pads the box.
      const boxed =
        recipe.fit === "contain" ||
        ((recipe.fit === "cover" || recipe.fit === "fill") && recipe.enlarge)
      return {
        src: formatUrl(preset, target),
        srcset: catalog.variants(preset).length > 1 ? formatSrcset(preset, target) : undefined,
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
