# How a Request Is Served

```text
/_renditions/v1/[<scope>/]<path>/<preset>.<hash>.<extension>
```

A URL has a scope exactly when the catalog declares [scopes](./scopes).
The hash identifies the preset options at one density, and the preset name only labels the URL.
The handler looks up the hash in the catalog, resolves the source, and then:

1. If the process or a shared readiness index remembers the rendition, it redirects right away.
2. Otherwise it checks storage and redirects if the rendition is there.
3. Otherwise it reads the source, renders it, writes the result, and redirects.

Within a process, equal concurrent requests are rendered once.
Replicas without a shared [`coordinator`](./replicas) may each render the same rendition and write equal files under its key.

## Redirect caching

The redirect is a `307` with `Cache-Control: public, max-age=86400`, so browsers and CDNs remember it for a day.
It points to the storage URL built from `publicUrl`, and a cached redirect cannot be revoked: after you move renditions to another domain, clients follow the old redirects until they expire.
If `publicUrl` never changes, pass a longer `redirectCacheControl` to `defineRenditionEventHandler()`.
