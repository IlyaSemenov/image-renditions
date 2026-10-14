# image-renditions

## 0.2.0

### Minor Changes

- d089e16: Catalogs can declare `scopes`, which type and validate the scope of every target.
- 9475868: The Nuxt module option `imgAttrs` sets default attributes of every `<RenditionImg>`.
- 440ad6a: `useRenditions().url()` and `srcset()` return `undefined` instead of throwing for an unsafe path.
- f0bbbe6: The `animation` option moves from the catalog `sources` to presets and `defaults`, where `preserve` renders GIF and WebP sources as animated WebP.
- 0aee719: Presets can show sources with listed extensions, such as SVG, as they are instead of rendering them.
- f0bbbe6: Processors can implement `assertRecipe()`, which `createRenditionServer()` calls for every variant in `catalog.allVariants`.
- d4dd671: The S3 stores take any client of AWS SDK v3, including the bare `S3Client`, instead of an object with `getObject`, `headObject` and `putObject` methods.
- d089e16: The catalog is passed to `createRenditionServer()` instead of the rendition handler.
- 3a00b47: `RenditionServer.resolve()` returns the storage keys of a target.
- bc7b107: Sources over a byte or pixel limit fail as `source-too-large` instead of `unsupported-source`.

### Patch Changes

- 336c404: `createSharpProcessor()` throws a `RangeError` for a `maxInputPixels` that is not a non-negative integer, instead of failing every rendition.

## 0.1.0

### Minor Changes

- dfc1553: Initial release.
