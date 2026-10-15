/** Calls an optional callback without waiting for it, so a failing or hanging callback cannot affect the operation. */
export function notify<T>(callback: ((value: T) => void) | undefined, value: T) {
  try {
    // The callback is typed as synchronous, but an async one returns a promise whose rejection must not go unhandled.
    Promise.resolve(callback?.(value)).catch(() => {})
  } catch {
    // A throwing callback is ignored like a rejecting one.
  }
}
