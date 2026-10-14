import { RenditionError } from "./error"

/** Bounds of concurrent processing. */
export interface LimiterOptions {
  /** Tasks running at once. */
  concurrency: number
  /** Tasks waiting for a slot; more are rejected immediately. */
  queueSize: number
  /** Milliseconds a task may wait for a slot before it is rejected. */
  queueTimeout: number
}

/** Runs tasks with bounded concurrency and a bounded wait queue. */
export interface Limiter {
  /**
   * Runs the task once a slot is free.
   *
   * @throws {RenditionError} When the queue is full or the wait times out, with reason `overloaded`.
   */
  run<T>(task: () => Promise<T>): Promise<T>
}

/** Creates a limiter with the given bounds. */
export function createLimiter({ concurrency, queueSize, queueTimeout }: LimiterOptions): Limiter {
  let active = 0
  const waiting: Array<() => void> = []

  function release() {
    const next = waiting.shift()
    if (next) {
      next()
    } else {
      active--
    }
  }

  function acquire() {
    if (active < concurrency) {
      active++
      return Promise.resolve()
    }
    if (waiting.length >= queueSize) {
      return Promise.reject(new RenditionError("overloaded", "The processing queue is full."))
    }
    return new Promise<void>((resolve, reject) => {
      // A slot is handed over directly from the finishing task, so `active` does not change on handover.
      const grant = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(grant), 1)
        reject(new RenditionError("overloaded", "Timed out waiting for a processing slot."))
      }, queueTimeout)
      waiting.push(grant)
    })
  }

  return {
    async run(task) {
      await acquire()
      try {
        return await task()
      } finally {
        release()
      }
    },
  }
}
