import { assertInteger } from "../assert"

import type { StoreCallOptions } from "./stores"

/**
 * Positive knowledge that renditions are published, keyed by their public URL.
 *
 * An index never records failures or absence.
 * A lost entry costs one storage check for a recipe in the catalog, but leaves a recipe missing from the catalog unservable.
 */
export interface ReadinessIndex {
  has(url: string, options?: StoreCallOptions): boolean | Promise<boolean>
  add(url: string, options?: StoreCallOptions): void | Promise<void>
}

/** Options of {@link createMemoryReadinessIndex}. */
export interface MemoryReadinessIndexOptions {
  /** Entries kept before the least recently used ones are evicted. */
  maxEntries?: number
}

/**
 * Creates a process-local readiness index with least-recently-used eviction.
 *
 * @throws {RangeError} When `maxEntries` is not a non-negative integer.
 */
export function createMemoryReadinessIndex({
  maxEntries = 10_000,
}: MemoryReadinessIndexOptions = {}): ReadinessIndex {
  assertInteger("maxEntries", maxEntries, 0, Number.MAX_SAFE_INTEGER)
  // Set iteration follows insertion order, so re-inserting on access keeps the least recently used entry first.
  const entries = new Set<string>()
  return {
    has(url) {
      if (!entries.has(url)) {
        return false
      }
      entries.delete(url)
      entries.add(url)
      return true
    },
    add(url) {
      entries.delete(url)
      entries.add(url)
      if (entries.size > maxEntries) {
        entries.delete(entries.values().next().value!)
      }
    },
  }
}
