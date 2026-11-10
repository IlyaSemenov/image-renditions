# Concurrency and Timeouts

The `limits` option of `createRenditionServer()` bounds rendering per process:

- `concurrency` — renditions processed at once, 2 by default.
- `queueSize` — renditions waiting for a slot, 100 by default.
- `queueTimeout` — milliseconds a rendition may wait for a slot, 30 seconds by default.
- `storageTimeout` — milliseconds a storage call may take, 15 seconds by default.
- `indexTimeout` — milliseconds a shared readiness index call may take, 1 second by default.

Requests beyond the queue, or waiting too long, fail as `overloaded`.
Processing itself has no timeout, because a timeout could not stop the processor and free its slot.

These limits bound image processing, not HTTP request rates.
Requests for renditions missing from the readiness indexes check result storage, even when the source does not exist.
On a public site, rate-limit requests per client at the CDN or reverse proxy.
