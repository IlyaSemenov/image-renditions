import { assertInteger } from "../assert"
import type { ReadinessIndex } from "../server/readiness"

import { DEFAULT_PREFIX, type RedisSendCommand } from "./command"

/** Options of {@link createRedisReadinessIndex}. */
export interface RedisReadinessIndexOptions {
  sendCommand: RedisSendCommand
  /** Prefix of the keys, `image-renditions:` by default; entries are stored under `<prefix>ready:<url>`. */
  prefix?: string
  /** Milliseconds an entry is kept after it was last added or found, 30 days by default. */
  ttl?: number
}

const DAY = 24 * 60 * 60 * 1000

/**
 * Creates a readiness index shared between replicas through Redis.
 *
 * @throws {RangeError} When `ttl` is not a positive integer.
 */
export function createRedisReadinessIndex({
  sendCommand,
  prefix = DEFAULT_PREFIX,
  ttl = 30 * DAY,
}: RedisReadinessIndexOptions): ReadinessIndex {
  assertInteger("ttl", ttl, 1, Number.MAX_SAFE_INTEGER)
  const toKey = (url: string) => `${prefix}ready:${url}`
  return {
    async has(url) {
      // Prolonging an entry tells in one command whether it exists, and keeps entries that replicas look up from expiring.
      const key = toKey(url)
      const reply = await sendCommand(["PEXPIRE", key, String(ttl)], key)
      if (reply !== 0 && reply !== 1) {
        throw new TypeError(`Redis replied to PEXPIRE with ${String(reply)}; expected 0 or 1.`)
      }
      return reply === 1
    },
    async add(url) {
      const key = toKey(url)
      await sendCommand(["SET", key, "1", "PX", String(ttl)], key)
    },
  }
}
