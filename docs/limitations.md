# Limitations

- Renditions are public, and anyone who knows a path that `resolveSource` serves can get its renditions.
  Keep private images out of what `resolveSource` maps, for example by serving only the folders of public images.
- A source must never change under its key: renditions of a replaced source keep showing the old image.
  Store new content under a new key.
- Deleting a source leaves its renditions in storage under its rendition prefix, which `server.resolve()` returns relative to the result store.
  With the `prefix` of `createS3Results()`, their S3 keys start with `<prefix>/<renditionPrefix>/`.
- A rendition of an animated source shows its first frame unless the preset sets [`animation: "preserve"`](./animation), a rendition of an SVG source is rasterized at the target size, and EXIF orientation is applied.
  A preset shows such sources as they are when it lists their extensions in [`originals`](./originals).
- Source paths are limited to 1024 characters.
