import { useRuntimeConfig } from "nuxt/app"
import { defineComponent, h, type PropType } from "vue"

import type { Catalog, RenditionTarget, RenditionVariant, ScopeName } from "../catalog"
import { encodePath, isSafePath, isSafeScope } from "../path"
import { assertDeclaredScope, isDeclaredScope, toDeclaredTarget } from "../scopes"
import { joinRenditionPath } from "../url"

import { findRenditionAttr } from "./img-attrs"

/** Attributes of an `img` element showing a rendition. */
export interface RenditionImgAttrs {
  /** Absent for an unsafe path. */
  src?: string
  srcset?: string
  width?: number
  height?: number
}

/**
 * Attributes every `<RenditionImg>` renders, such as `{ loading: "lazy", decoding: "async" }`.
 *
 * Attributes of an element override them; `src`, `srcset`, `width` and `height` belong to the rendition alone.
 */
export type DefaultImgAttrs = Record<string, string | number | boolean> & {
  src?: never
  srcset?: never
  width?: never
  height?: never
}

/** Options of a rendition URL. */
export interface RenditionUrlOptions<Scope extends string = string> {
  /** Scope of the path; defaults to the module's `defaultScope`. */
  scope?: Scope
  /** Density of the variant; defaults to `1`. */
  density?: number
}

/** Options of the `img` attributes of a rendition. */
export interface RenditionAttrsOptions<Scope extends string = string> {
  /** Scope of the path; defaults to the module's `defaultScope`. */
  scope?: Scope
  /** Whether to set `width` and `height`; `false` leaves the size to a component that sizes the image itself. */
  size?: boolean
}

/**
 * Registry of the catalog the Nuxt module serves, which the module fills with the type of its catalog.
 *
 * It types helpers defined in files of the application, such as {@link defineRenditionOriginalUrl}.
 */
// oxlint-disable-next-line typescript/no-empty-object-type -- the Nuxt module augments it
export interface RenditionRegister {}

/** Scope of the catalog in {@link RenditionRegister}, or any string without one. */
type RegisteredScope = RenditionRegister extends {
  catalog: infer C extends Pick<Catalog, "scopes">
}
  ? ScopeName<C>
  : string

/**
 * Defines the composable of the `originalUrl` module option, typing its targets by the catalog of the Nuxt module.
 *
 * The Nuxt module auto-imports it.
 */
export function defineRenditionOriginalUrl(
  useOriginalUrl: () => (target: RenditionTarget<RegisteredScope>) => string,
): () => (target: RenditionTarget<RegisteredScope>) => string {
  return useOriginalUrl
}

/** Options of {@link createRenditionHelpers}. */
export interface RenditionHelpersOptions<Scope extends string = string> {
  /** Scope of calls that set none. */
  defaultScope?: Scope
  /**
   * Composable returning a function that builds the URL of a source shown as it is; required when a preset lists `originals`.
   *
   * The function receives a safe logical path, which it must encode.
   */
  useOriginalUrl?: () => (target: RenditionTarget<Scope>) => string
  imgAttrs?: DefaultImgAttrs
}

/**
 * Binds `useRenditions()` and `<RenditionImg>` to a catalog.
 *
 * The Nuxt module calls it in a generated module; applications use the generated helpers.
 *
 * @throws {Error} When a preset lists `originals` and `useOriginalUrl` is missing.
 * @throws {RangeError} When `defaultScope` is not one of the scopes the catalog declares, or `imgAttrs` sets a rendition attribute.
 */
export function createRenditionHelpers<Name extends string, Scope extends string = string>(
  catalog: Catalog<Name, Scope>,
  // The scopes are inferred from the catalog alone, so a default scope it does not declare fails to compile.
  { defaultScope, useOriginalUrl, imgAttrs }: RenditionHelpersOptions<NoInfer<Scope>> = {},
) {
  if (!useOriginalUrl && catalog.presets.some(preset => catalog.originals(preset).length > 0)) {
    throw new Error(
      "[image-renditions] Pass `useOriginalUrl`, as a preset of the catalog lists `originals`.",
    )
  }
  if (defaultScope !== undefined && !isDeclaredScope(catalog.scopes, defaultScope)) {
    throw new RangeError(`Undeclared default rendition scope "${defaultScope}".`)
  }
  const renditionAttr = findRenditionAttr(imgAttrs)
  if (renditionAttr) {
    throw new RangeError(`Default image attribute "${renditionAttr}" is set by the rendition.`)
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
     * The path and the scope are checked here once, since the URLs below are joined from them or built by `useOriginalUrl` rather than by `catalog.url()`, which would check them.
     */
    function resolveTarget(
      path: string,
      scope: Scope | undefined,
    ): RenditionTarget<Scope> | undefined {
      if (!isSafePath(path)) {
        return undefined
      }
      const resolved = scope ?? defaultScope
      if (resolved !== undefined && !isSafeScope(resolved)) {
        throw new RangeError(`Invalid rendition scope "${resolved}".`)
      }
      const target = toDeclaredTarget(catalog.scopes, resolved, path)
      if (!target) {
        // Reports why the scope is not accepted.
        assertDeclaredScope(catalog.scopes, resolved)
      }
      return target!
    }

    /**
     * URL of a variant below the application base URL, for a target with an encoded path.
     *
     * `resolveTarget()` has checked the target and the catalog its variants, so the URL is joined without checks.
     */
    function joinVariantUrl(
      { label, hash, recipe }: RenditionVariant,
      scope: Scope | undefined,
      encodedPath: string,
    ) {
      return (
        base +
        joinRenditionPath(
          catalog.basePath,
          { scope, label, hash, format: recipe.format },
          encodedPath,
        )
      )
    }

    /** URLs of variants of a target, which encode its path once for all of them. */
    function formatVariantUrls(
      variants: readonly RenditionVariant[],
      { scope, path }: RenditionTarget<Scope>,
    ) {
      const encodedPath = encodePath(path)
      return variants.map(variant => joinVariantUrl(variant, scope, encodedPath))
    }

    /** `srcset` value of variants and their URLs. */
    function formatSrcset(variants: readonly RenditionVariant[], urls: readonly string[]) {
      return variants.map(({ density }, index) => `${urls[index]} ${density}x`).join(", ")
    }

    /**
     * URL of a rendition of a logical path, or of the source itself at every declared density when the preset lists its extension in `originals`.
     *
     * Returns `undefined` for an unsafe path, such as one with a `..` segment, so stored data never breaks rendering.
     *
     * @throws {RangeError} When the preset is unknown or does not declare the density, or the scope is invalid or not one the catalog declares.
     */
    function url(
      preset: Name,
      path: string,
      { scope, density }: RenditionUrlOptions<Scope> = {},
    ): string | undefined {
      const target = resolveTarget(path, scope)
      if (!target) {
        return undefined
      }
      // The density is checked for originals too, so a call fails the same way whatever the source.
      const variant = catalog.variant(preset, density, path)
      return catalog.isOriginal(preset, path)
        ? originalUrl!(target)
        : joinVariantUrl(variant, target.scope, encodePath(path))
    }

    /**
     * `srcset` attribute value listing every density of a preset.
     *
     * Returns `undefined` for an unsafe path, like `url()`, and for a source shown as it is, which has no densities.
     *
     * @throws {RangeError} When the preset is unknown, or the scope is invalid or not one the catalog declares.
     */
    function srcset(
      preset: Name,
      path: string,
      { scope }: Pick<RenditionUrlOptions<Scope>, "scope"> = {},
    ): string | undefined {
      const target = resolveTarget(path, scope)
      if (!target || catalog.isOriginal(preset, path)) {
        return undefined
      }
      const variants = catalog.variants(preset, path)
      return formatSrcset(variants, formatVariantUrls(variants, target))
    }

    /**
     * Attributes of an `img` element showing every density of a preset.
     *
     * `width` and `height` are set only when the output always has the size of the preset box, so they never distort the image, and `size: false` leaves them out.
     * A source that is already a URL, such as a `blob:`, `data:` or `https:` one, is returned unchanged as `src`.
     * A source whose extension the preset lists in `originals` gets only the `src` of the source itself.
     * An unsafe path, such as one with a `..` segment, yields no `src`, so stored data never breaks rendering.
     *
     * @throws {RangeError} When the preset is unknown, or the scope is invalid or not one the catalog declares.
     */
    function attrs(
      preset: Name,
      path: string,
      { scope, size = true }: RenditionAttrsOptions<Scope> = {},
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
      const variants = catalog.variants(preset, path)
      // `src` and the size come from density 1, which every preset has.
      const main = variants.findIndex(({ density }) => density === 1)
      const { recipe } = variants[main]!
      const urls = formatVariantUrls(variants, target)
      // Without enlargement a small source keeps its own size under `cover` and `fill`, while `contain` always pads the box.
      const boxed =
        recipe.fit === "contain" ||
        ((recipe.fit === "cover" || recipe.fit === "fill") && recipe.enlarge)
      // Attributes are left out rather than set to `undefined`, which would erase those of an element they are bound to.
      return {
        src: urls[main],
        // A single density adds nothing to `src`.
        ...(variants.length > 1 ? { srcset: formatSrcset(variants, urls) } : undefined),
        ...(size && boxed ? { width: recipe.width, height: recipe.height } : undefined),
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
      scope: { type: String as unknown as PropType<Scope>, default: undefined },
    },
    setup(props) {
      const renditions = useRenditions()
      return () => {
        return h("img", {
          // Defaults set no rendition attribute, as checked above, so they never add a source or a size the rendition lacks.
          ...imgAttrs,
          ...renditions.attrs(props.preset, props.src, { scope: props.scope }),
        })
      }
    },
  })

  return { useRenditions, RenditionImg }
}
