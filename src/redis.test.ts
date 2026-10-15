import { RedisClient, type Subprocess } from "bun"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"

import { createRedisCoordinator, createRedisReadinessIndex, type RedisSendCommand } from "./redis"

// The tests run against a disposable `redis-server` on a free port.
let server: Subprocess
let client: RedisClient
let sendCommand: RedisSendCommand

beforeAll(async () => {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  const { port } = probe
  probe.stop(true)
  server = Bun.spawn(
    [
      "redis-server",
      "--port",
      String(port),
      "--bind",
      "127.0.0.1",
      "--save",
      "",
      "--appendonly",
      "no",
    ],
    { stdout: "ignore", stderr: "inherit" },
  )
  client = new RedisClient(`redis://127.0.0.1:${port}`, { autoReconnect: false })
  sendCommand = ([command, ...args]) => client.send(command!, args)
  for (let attempt = 0; ; attempt++) {
    try {
      await client.connect()
      break
    } catch (error) {
      if (attempt === 50) {
        throw error
      }
      await Bun.sleep(20)
    }
  }
})

afterAll(() => {
  client?.close()
  server?.kill()
})

beforeEach(async () => {
  await client.send("FLUSHALL", [])
})

/** Creates a promise with its resolver exposed. */
function defer<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => (resolve = r))
  return { promise, resolve }
}

/** Tells whether a command renews a lock. */
function isRenewal(args: string[]) {
  return args[0] === "EVAL" && args[1]!.includes("PEXPIRE")
}

/** Wraps `sendCommand` to resolve to the first replies to the renewal and the release of a lock. */
function observeLock() {
  const renewed = defer<unknown>()
  const released = defer<unknown>()
  const observed: RedisSendCommand = async (args, key) => {
    const reply = await sendCommand(args, key)
    if (args[0] === "EVAL") {
      ;(isRenewal(args) ? renewed : released).resolve(reply)
    }
    return reply
  }
  return { sendCommand: observed, renewed: renewed.promise, released: released.promise }
}

describe("readiness index", () => {
  test("finds the added URLs under its prefix", async () => {
    const index = createRedisReadinessIndex({ sendCommand, prefix: "app:" })
    await index.add("https://cdn.example.com/a.avif")

    expect(await index.has("https://cdn.example.com/a.avif")).toBe(true)
    expect(await index.has("https://cdn.example.com/b.avif")).toBe(false)
    expect(await client.exists("app:ready:https://cdn.example.com/a.avif")).toBe(true)
  })

  test("adds an entry with the TTL", async () => {
    const index = createRedisReadinessIndex({ sendCommand, ttl: 60_000 })
    await index.add("a")

    expect(await client.pttl("image-renditions:ready:a")).toBeGreaterThan(50_000)
  })

  test("prolongs a found entry", async () => {
    const index = createRedisReadinessIndex({ sendCommand, ttl: 60_000 })
    await index.add("a")
    await client.send("PEXPIRE", ["image-renditions:ready:a", "10000"])
    await index.has("a")

    expect(await client.pttl("image-renditions:ready:a")).toBeGreaterThan(50_000)
  })

  test("rejects an unexpected reply", async () => {
    const index = createRedisReadinessIndex({ sendCommand: async () => "1" })

    await expect(index.has("a")).rejects.toThrow(TypeError)
  })

  test("rejects a TTL that is not a positive integer", () => {
    for (const ttl of [0, 1.5]) {
      expect(() => createRedisReadinessIndex({ sendCommand, ttl })).toThrow(RangeError)
    }
  })
})

describe("coordinator", () => {
  test("runs the tasks of replicas on one key one at a time", async () => {
    const holder = createRedisCoordinator({ sendCommand })
    const waiter = createRedisCoordinator({ sendCommand })
    const events: string[] = []
    const started = defer()
    const holding = defer()
    const holderRun = holder.run("a", async () => {
      events.push("holder starts")
      started.resolve()
      await holding.promise
      events.push("holder ends")
    })
    await started.promise
    const waiterRun = waiter.run("a", async () => {
      events.push("waiter starts")
    })
    await Bun.sleep(100)
    holding.resolve()
    await Promise.all([holderRun, waiterRun])

    expect(events).toEqual(["holder starts", "holder ends", "waiter starts"])
  })

  test("shares one task run between equal calls of a process", async () => {
    const coordinator = createRedisCoordinator({ sendCommand })
    let runs = 0
    const task = async () => {
      runs++
      await Bun.sleep(20)
      return runs
    }

    expect(await Promise.all([coordinator.run("a", task), coordinator.run("a", task)])).toEqual([
      1, 1,
    ])
  })

  test("releases the lock when the task fails", async () => {
    const lock = observeLock()
    const coordinator = createRedisCoordinator({ sendCommand: lock.sendCommand })
    const failure = new Error("failed")

    await expect(coordinator.run("a", () => Promise.reject(failure))).rejects.toBe(failure)
    expect(await lock.released).toBe(1)
    expect(await client.exists("image-renditions:lock:a")).toBe(false)
  })

  test("keeps renewing the lock while the task runs", async () => {
    const replies: unknown[] = []
    const renewedTwice = defer<unknown[]>()
    const coordinator = createRedisCoordinator({
      async sendCommand(args, key) {
        const reply = await sendCommand(args, key)
        if (isRenewal(args) && replies.push(reply) === 2) {
          renewedTwice.resolve(replies)
        }
        return reply
      },
      lockTtl: 1500,
    })

    expect(await coordinator.run("a", () => renewedTwice.promise)).toEqual([1, 1])
  })

  test("neither renews nor releases a lock that another replica took over", async () => {
    const lock = observeLock()
    const coordinator = createRedisCoordinator({ sendCommand: lock.sendCommand, lockTtl: 1500 })
    await coordinator.run("a", async () => {
      await client.set("image-renditions:lock:a", "other")
      await lock.renewed
    })
    await lock.released

    expect(await client.get("image-renditions:lock:a")).toBe("other")
    expect(await client.pttl("image-renditions:lock:a")).toBe(-1)
  })

  test("sends the next renewal only after the reply to the previous one, and none after the task", async () => {
    let renewals = 0
    const hung = defer<number>()
    const coordinator = createRedisCoordinator({
      async sendCommand(args, key) {
        if (isRenewal(args)) {
          renewals++
          return hung.promise
        }
        return sendCommand(args, key)
      },
      lockTtl: 30,
    })
    await coordinator.run("a", () => Bun.sleep(100))
    hung.resolve(1)
    await Bun.sleep(100)

    expect(renewals).toBe(1)
  })

  test("runs the task after waiting for a lock held elsewhere, leaving that lock alone", async () => {
    await client.send("SET", ["image-renditions:lock:a", "other", "PX", "60000"])
    const coordinator = createRedisCoordinator({ sendCommand, waitTimeout: 100 })

    expect(await coordinator.run("a", async () => "done")).toBe("done")
    expect(await client.get("image-renditions:lock:a")).toBe("other")
  })

  test("ends the wait for a lock by the deadline even when Redis stops replying", async () => {
    const errors: unknown[] = []
    let attempts = 0
    const coordinator = createRedisCoordinator({
      async sendCommand() {
        attempts++
        return attempts === 1 ? null : new Promise(() => {})
      },
      waitTimeout: 100,
      commandTimeout: 10_000,
      onError: error => errors.push(error),
    })
    const started = Date.now()

    expect(await coordinator.run("a", async () => "done")).toBe("done")
    expect(Date.now() - started).toBeLessThan(5000)
    expect(errors).toEqual([])
  })

  test("runs the task without the lock when Redis fails", async () => {
    const errors: unknown[] = []
    const failure = new Error("unavailable")
    const coordinator = createRedisCoordinator({
      sendCommand: () => Promise.reject(failure),
      onError: error => errors.push(error),
    })

    expect(await coordinator.run("a", async () => "done")).toBe("done")
    expect(errors).toContain(failure)
  })

  test("runs the task without the lock when Redis gives an unexpected reply", async () => {
    const errors: unknown[] = []
    const coordinator = createRedisCoordinator({
      sendCommand: async () => "1",
      onError: error => errors.push(error),
    })

    expect(await coordinator.run("a", async () => "done")).toBe("done")
    expect(errors).toEqual([expect.any(TypeError)])
  })

  test("runs the task without the lock when Redis is slow, and releases a lock taken late", async () => {
    const errors: unknown[] = []
    const late = defer()
    const sent: string[][] = []
    const coordinator = createRedisCoordinator({
      async sendCommand(args) {
        sent.push(args)
        if (args[0] === "SET") {
          await late.promise
          return "OK"
        }
        return 1
      },
      commandTimeout: 50,
      waitTimeout: 0,
      onError: error => errors.push(error),
    })

    expect(await coordinator.run("a", async () => "done")).toBe("done")
    expect(errors).toHaveLength(1)
    late.resolve()
    await Bun.sleep(0)
    expect(sent.map(([command]) => command)).toEqual(["SET", "EVAL"])
  })

  test("rejects a timeout that is not an integer in its range", () => {
    for (const options of [{ lockTtl: 0 }, { waitTimeout: -1 }, { commandTimeout: 2 ** 31 }]) {
      expect(() => createRedisCoordinator({ sendCommand, ...options })).toThrow(RangeError)
    }
  })
})
