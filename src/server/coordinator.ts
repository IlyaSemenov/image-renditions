/**
 * Serializes work on the same rendition.
 *
 * Callers with an equal key share the outcome of one task run.
 * A cross-replica implementation can hold a distributed lock instead, because the task rechecks whether the rendition is already published.
 */
export interface Coordinator {
  run<T>(key: string, task: () => Promise<T>): Promise<T>
}

/** Creates a coordinator that merges concurrent equal requests within the process. */
export function createLocalCoordinator(): Coordinator {
  const running = new Map<string, Promise<unknown>>()
  return {
    run<T>(key: string, task: () => Promise<T>) {
      const current = running.get(key)
      if (current) {
        return current as Promise<T>
      }
      const promise = task().finally(() => running.delete(key))
      running.set(key, promise)
      return promise
    },
  }
}
