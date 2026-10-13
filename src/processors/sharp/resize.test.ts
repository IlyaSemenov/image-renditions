import { expect, test } from "bun:test"

import { normalizeRecipe, type RenditionOptions } from "../../recipe"

import { planResize } from "./resize"

function plan(options: RenditionOptions, width: number, height: number) {
  return planResize(normalizeRecipe({ options, pipeline: 1 }), width, height)
}

test("resizes as the recipe sets while the image stays within the side limit", () => {
  expect(plan({ width: 30, height: 30 }, 1, 1000)).toEqual({
    resize: {
      width: 30,
      height: 30,
      fit: "cover",
      position: "center",
      background: undefined,
      withoutEnlargement: true,
    },
  })
  expect(plan({}, 100, 100)).toEqual({ resize: undefined })
})

test("cuts the long side under cover to what the limit allows, centered with an even remainder", () => {
  // The scale is 30, so 546 rows fit, and one row less leaves an even remainder of 456.
  expect(plan({ width: 30, height: 30, enlarge: true }, 1, 1001).extract).toEqual({
    left: 0,
    top: 228,
    width: 1,
    height: 545,
  })
})

test("keeps the full cut under cover when evening it out would let the long side drive the scale", () => {
  // Two rows fit; one row would need a scale of 12000 on it, taking the other side to 24000.
  expect(plan({ width: 12000, height: 12000, enlarge: true }, 2, 5).extract).toEqual({
    left: 0,
    top: 1,
    width: 2,
    height: 2,
  })
})
