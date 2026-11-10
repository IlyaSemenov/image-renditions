# Originals

Some sources are better shown as they are: SVG stays crisp at any zoom, and [`createSharpProcessor()`](./processing) cannot decode ICO or BMP.
`originals` lists the extensions of such sources, in lowercase and without the dot:

```ts
export default defineCatalog({
  defaults: { originals: ["svg", "ico", "bmp"] },
  presets: {
    logo: { height: 32 },
    // Email clients do not show SVG.
    "email-logo": { height: 32, originals: [] },
  },
})
```

For such a path, `<RenditionImg>` and `useRenditions()` give the URL of the source itself:

- `url()` returns it for every declared density, and `srcset()` returns `undefined`.
- `<RenditionImg>` renders no `srcset`, `width` or `height`, so size such images with CSS.
- `gif` in the list shows every GIF as it is, because a path does not tell an animated GIF from a still one.
  Leave it out and set [`animation: "preserve"`](./animation) instead to shrink animated GIFs.
- Only the extension is checked, not the content, and the server still renders the source when its rendition URL is requested.
- Changing `originals` keeps the hashes of the preset.

Without Nuxt, check `catalog.isOriginal()` and build the URL yourself, as in [Showing Images](./showing-images#without-nuxt).

## URLs of originals

Only the app knows where its sources are served from, so it builds their URLs.
Set the module option `originalUrl` to a module whose default export is a composable returning a function from the scope and the logical path to the URL.
`defineRenditionOriginalUrl()`, which the module auto-imports, types them by the catalog:

```ts
// app/renditions/original-url.ts
import { encodePath } from "image-renditions"

export default defineRenditionOriginalUrl(() => {
  const { uploadsUrl } = useRuntimeConfig().public
  return ({ path }) => `${uploadsUrl}/${encodePath(path)}`
})
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  renditions: {
    catalog: "#shared/renditions",
    originalUrl: "~/renditions/original-url",
  },
})
```

- `useRenditions()` calls the composable every time it is called, so the composable may use other composables.
- The function receives the scope after `defaultScope`, and a path that is safe but not encoded: `encodePath()` keeps characters such as `#` and `?` inside the path.
- The URL it returns is used as is, without `app.baseURL`.
- The build fails when a preset lists `originals` and `originalUrl` is not set.

## SVG safety

`<img>` never runs scripts of an SVG, but an SVG opened as a page runs them on the site it is served from.
Keep SVG files that users upload from running scripts as part of the app in any of these ways:

- Serve them from a separate domain rather than a subdomain of the app.
- Serve them with a `Content-Security-Policy: sandbox` response header.
- Store them with `Content-Disposition: attachment`, which S3 keeps with the object, so browsers download such a file instead of opening it.
