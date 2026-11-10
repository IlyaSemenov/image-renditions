# Multiple Replicas

Each process remembers the renditions it has published, and renders a rendition once for its concurrent requests.
With several replicas, `image-renditions/redis` shares both between them through Redis:

- The readiness index lets a replica redirect to a rendition that another replica published, without checking storage.
- The coordinator lets one replica render a rendition while the others wait for it.

## Connect Redis

Create a `sendCommand` callback for your Redis or Valkey client:

```ts
// node-redis: createClient()
const sendCommand = (args: string[]) => redis.sendCommand(args)

// node-redis: createSentinel()
const sendCommand = (args: string[]) => sentinel.sendCommand(false, args)

// node-redis: createCluster()
const sendCommand = (args: string[], key: string) => cluster.sendCommand(key, false, args)

// ioredis or iovalkey: Redis or Cluster, including Sentinel connections
const sendCommand = ([command, ...args]: string[]) => redis.call(command!, args)

// Bun: RedisClient
const sendCommand = ([command, ...args]: string[]) => redis.send(command!, args)
```

Pass it to `createRedisReadinessIndex()` and `createRedisCoordinator()`:

```ts
// server/renditions.ts
import { createRedisCoordinator, createRedisReadinessIndex } from "image-renditions/redis"

const server = createRenditionServer({
  // catalog, stores and processor as in Getting Started
  readiness: { shared: createRedisReadinessIndex({ sendCommand }) },
  coordinator: createRedisCoordinator({ sendCommand, onError: reportError }),
})
```

## Readiness index

The readiness index forgets a rendition 30 days after it last added or found it, even if the rendition is still requested; pass `ttl` in milliseconds to change it.
A forgotten rendition costs one storage check while its recipe is in the catalog; after the recipe is removed, its [outdated URL](./errors#outdated-urls) fails as `unknown-recipe`.
When the index fails or exceeds [`limits.indexTimeout`](./limits), the server reports the error to its `onError` and checks storage instead.

## Coordinator

The coordinator holds a lock in Redis while one replica renders a rendition, and other replicas wait for it to finish:

- `lockTtl` — milliseconds a lock outlives a replica that stopped renewing it, such as a crashed one, 30 seconds by default.
- `waitTimeout` — milliseconds a replica waits for the lock before it renders the rendition anyway, 30 seconds by default.
- `commandTimeout` — milliseconds Redis may take to reply to an attempt to take the lock, 1 second by default.
  A replica may wait this long even when `waitTimeout` is shorter.

The lock only saves work: when Redis fails or does not reply in time, the coordinator reports the error to `onError` and renders without the lock.
If a lock is lost, for example on a Sentinel failover, the worst case is that two replicas render the same rendition.

## Keys and permissions

Keys start with `image-renditions:`; pass `prefix` to the readiness index and the coordinator to change it.
With Redis ACL, the user needs access to the keys under the prefix, such as `~image-renditions:*`, and to the commands `GET`, `SET`, `PEXPIRE`, `DEL` and `EVAL`.

To share the readiness index and the lock between replicas through a database other than Redis, implement the [`ReadinessIndex` and `Coordinator`](./extending) interfaces.
