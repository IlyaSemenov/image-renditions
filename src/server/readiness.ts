/**
 * Positive knowledge that renditions are published, keyed by their public URL.
 *
 * An index never records failures or absence.
 * A lost entry costs one storage check for a recipe in the catalog, but leaves a recipe missing from the catalog unservable.
 */
export interface ReadinessIndex {
  has(url: string): boolean | Promise<boolean>
  add(url: string): void | Promise<void>
}

/** Options of {@link createMemoryReadinessIndex}. */
export interface MemoryReadinessIndexOptions {
  /** Entries kept before the least recently used ones are evicted. */
  maxEntries?: number
}

/** Creates a process-local readiness index with least-recently-used eviction. */
export function createMemoryReadinessIndex({
  maxEntries = 10_000,
}: MemoryReadinessIndexOptions = {}): ReadinessIndex {
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
