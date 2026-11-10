# Showing Images

## `<RenditionImg>`

`<RenditionImg>` renders `src`, and a `srcset` when the preset has several densities.

- It also renders `width` and `height` when the image always has the preset size: with `contain`, or with `cover` and `fill` when `enlarge` is set.
  It renders neither for other presets, including ones that set a single side, so size their images with CSS.
- A `src` that is already a URL, such as `blob:` or `https:`, renders unchanged, for example a preview of a file being uploaded.
- An unsafe path, such as one with a `..` segment, renders no `src` instead of breaking the page.
- A source whose extension the preset lists in [`originals`](./originals) renders as it is.
- A GIF or WebP source of a preset with [`animation: "preserve"`](./animation) renders its animated variants.

## `useRenditions()`

`useRenditions()` builds the same URLs in code, prefixing rendition URLs with `app.baseURL`:

```ts
const renditions = useRenditions()

renditions.url("cover", post.coverPath)
renditions.url("avatar", path, { density: 2 })
renditions.srcset("avatar", path)
renditions.attrs("avatar", path) // src, srcset and size of <RenditionImg>, for your own img element
renditions.attrs("avatar", path, { size: false }) // src and srcset, for a component that sizes the image itself
```

`url()` and `srcset()` return `undefined` for an unsafe path.

> For users coming from `@nuxt/image`: this module is not an `@nuxt/image` provider, so instead of `<NuxtImg>` and `useImage()`, use `<RenditionImg>` and `useRenditions()` with catalog presets.

## Module options

Options of the Nuxt module, under `renditions`:

- `catalog` — module exporting the catalog by default; required.
- `handler` — optional module exporting the h3 handler by default, mounted at the catalog base path.
- `defaultScope` — optional [scope](./scopes) for `<RenditionImg>` and `useRenditions()`.
- `originalUrl` — module building URLs of [originals](./originals); required when a preset lists `originals`.
- `imgAttrs` — attributes every `<RenditionImg>` renders, such as `{ loading: "lazy", decoding: "async" }`.
  An attribute of the element overrides them, for example `loading="eager"` on an image above the fold.

## Without Nuxt

Build URLs in the app with the catalog, which is safe to import in browsers:

```ts
catalog.url("avatar", { path: "avatars/42.jpg" })
// /_renditions/v1/avatars/42.jpg/avatar.faf7e221f65d.avif

catalog.srcset("avatar", { path: "avatars/42.jpg" })
```

They throw a `RangeError` for an unsafe path; check stored paths with `isSafePath()` first.
With [originals](./originals) in the catalog, check `catalog.isOriginal()` and build the URL of such a source yourself:

```ts
function logoUrl(path: string) {
  if (!isSafePath(path)) {
    return undefined
  }
  if (catalog.isOriginal("logo", path)) {
    return `https://uploads.example.com/${encodePath(path)}`
  }
  return catalog.url("logo", { path })
}
```
