# Presets

Options of a preset, or of `defaults`, which every preset overrides field by field:

- `width`, `height` — size in CSS pixels at density 1; with one side set, the other keeps the aspect ratio.
- `fit` — how the image fills the box when both sides are set:
  - `cover` (default) crops what overflows the box.
  - `contain` letterboxes the image inside the box.
  - `fill` stretches the image to the box.
  - `inside` and `outside` keep the aspect ratio, so one side of the output is smaller or larger than the box.
- `position` — `center` (default), `top`, `bottom`, `left`, `right`, or content-aware `entropy` and `attention` for `cover`.
- `enlarge` — upscale sources smaller than the target; otherwise they keep their size.
- `background` — hex color for `contain` letterboxing, transparent by default, and for flattening transparency into JPEG, white by default.
- `format` — `avif` (default), `webp`, `jpeg` or `png`.
- `quality` — encoder quality from 1 to 100, by default 50 for `avif` and 80 for `webp` and `jpeg`; `png` is lossless.
- `effort` — CPU effort of the `avif` (0–9) and `webp` (0–6) encoders, 4 by default; other formats ignore it.
- `densities` — pixel densities to render, which include `1`; `[1]` by default.
- `animation` — `first-frame` (default) renders the first frame of animated sources, and `preserve` keeps the animation of GIF and WebP sources; see [Animation](./animation).
- `originals` — extensions of sources shown as they are, so no option above applies to them; see [Originals](./originals).

Options of the catalog:

- `basePath` — path the handler is mounted at, `/_renditions` by default.
- `pipelineVersion` — bump it to render every image again, for example after switching to another processor.

Changing an option that affects the output gives the images of the preset new URLs, and they are rendered again on their first request.
Renaming a preset keeps its stored renditions.
