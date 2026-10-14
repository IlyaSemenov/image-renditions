---
"image-renditions": patch
---

`createSharpProcessor()` throws a `RangeError` for a `maxInputPixels` that is not a non-negative integer, instead of failing every rendition.
