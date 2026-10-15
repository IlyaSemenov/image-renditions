/** Throws a `RangeError` unless a value is an integer from `min` to `max`. */
export function assertInteger(name: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`Invalid ${name} ${value}; expected an integer from ${min} to ${max}.`)
  }
}

/** Longest delay of Node timers, in milliseconds. */
export const MAX_TIMEOUT = 2 ** 31 - 1
