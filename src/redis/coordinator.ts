import { assertInteger, MAX_TIMEOUT } from "../assert"
import { type Coordinator, createLocalCoordinator } from "../server/coordinator"
import { notify } from "../server/notify"

import { DEFAULT_PREFIX, type RedisSendCommand } from "./command"

/** Options of {@link createRedisCoordinator}. */
export interface RedisCoordinatorOptions {
  sendCommand: RedisSendCommand
  /** Prefix of the keys, `image-renditions:` by default; locks are stored under `<prefix>lock:<url>`. */
  prefix?: string
  /**
   * Milliseconds a lock outlives a holder that stopped renewing it, such as a crashed process.
   *
   * The holder renews it while its task runs, a third of this time after the reply to the previous renewal.
   */
  lockTtl?: number
  /**
   * Milliseconds a call waits for a lock held by another replica before it runs its task anyway.
   *
   * The first attempt to take the lock gets the whole `commandTimeout` even when this is shorter.
   */
  waitTimeout?: number
  /** Milliseconds an attempt to take a lock may take before it counts as failed. */
  commandTimeout?: number
  /**
   * Receives Redis failures to take, renew or release a lock; a call that fails to take the lock runs its task without it.
   *
   * It is not awaited, and its own failures are ignored.
   */
  onError?(error: unknown): void
}

/** Shortest and longest pauses between attempts to take a lock held by another replica. */
const POLL_DELAYS = { min: 50, max: 1000 }

// The scripts change a lock only while it holds the token of the caller, so a holder whose lock expired cannot touch the lock of another replica.
const RELEASE_SCRIPT = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`
const RENEW_SCRIPT = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) end return 0`

/**
 * Creates a coordinator that lets one replica render a rendition while the others wait for it, holding a lock in Redis.
 *
 * The lock only saves work, because a task rechecks whether its rendition is published.
 * So a call runs its task without the lock when Redis fails or another replica holds the lock beyond `waitTimeout`, and a lock lost on a Redis failover costs a duplicate rendering at most.
 *
 * @throws {RangeError} When a timeout is not an integer in its range.
 */
export function createRedisCoordinator({
  sendCommand,
  prefix = DEFAULT_PREFIX,
  lockTtl = 30_000,
  waitTimeout = 30_000,
  commandTimeout = 1000,
  onError,
}: RedisCoordinatorOptions): Coordinator {
  assertInteger("lockTtl", lockTtl, 1, MAX_TIMEOUT)
  assertInteger("waitTimeout", waitTimeout, 0, MAX_TIMEOUT)
  assertInteger("commandTimeout", commandTimeout, 1, MAX_TIMEOUT)
  // Equal calls within the process share one lock and one task run.
  const local = createLocalCoordinator()

  /** Sends a command whose reply nobody waits for, reporting its failure. */
  function sendDetached(args: string[], key: string) {
    send(args, key).catch((error: unknown) => notify(onError, error))
  }

  /** Sends a command, turning a synchronous throw into a rejection. */
  function send(args: string[], key: string) {
    return new Promise<unknown>(resolve => resolve(sendCommand(args, key)))
  }

  /**
   * Tries to take a lock once, and resolves to whether it was taken, or to `undefined` when Redis does not reply within the timeout.
   *
   * @throws {Error} When Redis fails or gives an unexpected reply.
   */
  async function acquire(key: string, token: string, timeout: number) {
    const reply = send(["SET", key, token, "NX", "PX", String(lockTtl)], key).then(value => {
      if (value !== "OK" && value !== null) {
        throw new TypeError(`Redis replied to SET with ${String(value)}; expected OK or null.`)
      }
      return value === "OK"
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<undefined>(resolve => {
      timer = setTimeout(() => resolve(undefined), timeout)
    })
    try {
      const acquired = await Promise.race([reply, expired])
      if (acquired === undefined) {
        // A lock taken after the timeout is released, so that it does not keep other replicas waiting.
        reply.then(
          late => late && sendDetached(["EVAL", RELEASE_SCRIPT, "1", key, token], key),
          () => {},
        )
      }
      return acquired
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Starts renewing a lock and returns the function that stops it.
   *
   * Each renewal is sent a third of `lockTtl` after the reply to the previous one, so that a hung Redis does not pile up commands.
   */
  function startRenewal(key: string, token: string) {
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const schedule = () => {
      timer = setTimeout(() => {
        send(["EVAL", RENEW_SCRIPT, "1", key, token, String(lockTtl)], key)
          .catch((error: unknown) => notify(onError, error))
          .finally(() => stopped || schedule())
      }, lockTtl / 3)
    }
    schedule()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }

  async function runLocked<T>(key: string, task: () => Promise<T>): Promise<T> {
    const token = crypto.randomUUID()
    const deadline = Date.now() + waitTimeout
    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - Date.now()
      if (attempt > 0 && remaining <= 0) {
        return task()
      }
      // The first attempt gets the whole `commandTimeout` even when `waitTimeout` is shorter, and later ones end by the deadline.
      const timeout = attempt === 0 ? commandTimeout : Math.min(commandTimeout, remaining)
      let acquired: boolean | undefined
      try {
        acquired = await acquire(key, token, timeout)
      } catch (error) {
        notify(onError, error)
        return task()
      }
      if (acquired) {
        break
      }
      if (acquired === undefined) {
        // An attempt cut short by the deadline does not mean that Redis is slow.
        if (timeout === commandTimeout) {
          notify(onError, new Error(`Redis did not reply within ${commandTimeout} ms.`))
        }
        return task()
      }
      await new Promise(resolve =>
        setTimeout(
          resolve,
          Math.min(POLL_DELAYS.min * 2 ** attempt, POLL_DELAYS.max, deadline - Date.now()),
        ),
      )
    }
    // Processing has no timeout, so the lock is renewed for as long as the task runs rather than given a fixed lifetime.
    const stopRenewal = startRenewal(key, token)
    try {
      return await task()
    } finally {
      stopRenewal()
      // The result need not wait for the release, as a lock that is not released expires after `lockTtl`.
      sendDetached(["EVAL", RELEASE_SCRIPT, "1", key, token], key)
    }
  }

  return {
    run(key, task) {
      return local.run(key, () => runLocked(`${prefix}lock:${key}`, task))
    },
  }
}
