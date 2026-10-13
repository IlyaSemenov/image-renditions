import { expect, test } from "bun:test"

import { createMemoryReadinessIndex } from "./readiness"

test("evicts the least recently used entry beyond its capacity", () => {
  const index = createMemoryReadinessIndex({ maxEntries: 2 })
  index.add("a")
  index.add("b")
  index.has("a")
  index.add("c")

  expect(["a", "b", "c"].map(url => index.has(url))).toEqual([true, false, true])
})

test("rejects a capacity that is not a non-negative integer", () => {
  for (const maxEntries of [-1, 1.5, Number.POSITIVE_INFINITY]) {
    expect(() => createMemoryReadinessIndex({ maxEntries })).toThrow(RangeError)
  }
})
