# Rendering Outside Requests

`server.ensure()` publishes one density of a preset without a request, for example right after an upload:

```ts
const path = "avatars/42.jpg"
for (const { recipe } of catalog.variants("avatar", path)) {
  await server.ensure(recipe, { scope: "tenant", path }, { tenant: "acme" })
}
```

The path chooses the [animated](./animation) variants of sources that have them.

It resolves to the key and public URL of the rendition after it is written or found in storage.
