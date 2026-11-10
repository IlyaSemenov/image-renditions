# Animation

A rendition of an animated source shows its first frame.
`animation: "preserve"` keeps the animation of GIF and WebP sources instead:

```ts
export default defineCatalog({
  presets: {
    thumb: { width: 96, height: 96 },
    content: { width: 800, densities: [1, 2], animation: "preserve" },
  },
})
```

- A path with the `gif` or `webp` extension gets variants of its own, which `url()`, `srcset()` and `<RenditionImg>` choose by the extension, as a path does not tell an animated source from a still one.
- These variants are WebP and take `quality` and `effort` only from a preset whose `format` is `webp`, since values for another format do not suit WebP.
- A still GIF or WebP source renders as a still WebP image.
- Only the extension is checked, and the server renders any source with these variants when their URL is requested.
- The variants of other sources keep their hashes, so only GIF and WebP sources render again.
- [`originals`](./originals) take precedence, so a preset that lists `gif` in them shows GIF sources as they are.

To render the animated variants ahead of a request, pass the source path to `catalog.variants()`, as in [Rendering Outside Requests](./rendering-outside-requests).

How much of an animation a rendition keeps depends on the processor; see [Processing](./processing#animation) for `createSharpProcessor()`.
`createRenditionServer()` fails when its processor cannot render a variant of the catalog.
