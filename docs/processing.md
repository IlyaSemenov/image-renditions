# Processing

`createSharpProcessor()` from `image-renditions/sharp` processes images with [sharp](https://sharp.pixelplumbing.com).
Sources over 100 megapixels fail as `source-too-large`; pass `maxInputPixels` to `createSharpProcessor()` to change the limit, or `0` to remove it.
A source that a preset would scale beyond 16383 pixels on a side, such as a narrow strip enlarged to the preset width, is scaled less to stay within that limit, so its rendition is smaller than the preset sets.
Under `cover`, such a source is cropped instead, and its rendition keeps the preset size.

To process images with another library, implement the [`Processor`](./extending) interface and pass your implementation to `createRenditionServer()` as `processor`.

## Animation

`createSharpProcessor()` keeps the [animation](./animation) of GIF and WebP sources.
It does not crop animations by `entropy` or `attention`, so a server fails to start with a preset that combines them.
It renders the first frame of other animated sources, such as APNG and animated AVIF, of an animation with an EXIF orientation, and of an animation beyond a limit:

- `maxFrames` — most frames, 1000 by default.
- `maxAnimationPixels` — most pixels of all frames, each counted at the larger of the source and the rendition size, 50 megapixels by default.

`0` removes a limit.
An animation at the pixel limit may take about 4 bytes of memory per pixel, and its encoder needs more, so plan memory for [`limits.concurrency`](./limits) such renditions at once.
Changing the limits keeps stored renditions as they are; bump `pipelineVersion` to render them again.

When a preset keeps the animation and a GIF or WebP animation renders its first frame because of its EXIF orientation or a limit, `createRenditionServer()` passes it to `onDegradation` once the rendition is written.
The reason is `animation-orientation`, `animation-frames` or `animation-pixels`, and the message has the values involved, so you can log such renditions and tune the limits:

```ts
const server = createRenditionServer({
  // ...
  onDegradation({ message, target }) {
    console.warn(`The rendition of ${target.path} is degraded: ${message}`)
  },
})
```
