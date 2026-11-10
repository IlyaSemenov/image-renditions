# Scopes

The path an app stores for an upload, such as `avatars/42.jpg`, is often not its storage key.
Each tenant may keep its uploads under its own prefix, and some files may be shared by all tenants, so the same path can mean different files.

Scopes and `resolveSource` let the server decide where a path lives:

- The scope tells which space a path belongs to, such as `tenant` or `shared`.
  One page may show images of several spaces, so each URL carries its scope.
- The context holds what the request determines, such as the current tenant; `getContext` derives it from the request, so a client cannot change it by editing a URL.
- `resolveSource` maps the scope, the path and the context to storage keys, or rejects them.

Without `resolveSource`, an unscoped path is the key itself, and scoped paths are rejected.

## Declare scopes

For example, with uploads of several tenants and files shared between them, declare both scopes in the catalog:

```ts
// shared/renditions.ts
export default defineCatalog({
  scopes: ["tenant", "shared"],
  presets: {
    // ...
  },
})
```

- Scope names are type-checked against the catalog, like preset names.
- `catalog.url()` requires a scope.
  `useRenditions()` and `<RenditionImg>` use the module's `defaultScope` when a call has no scope, and throw a `RangeError` when there is neither.
- The server rejects a target with another scope or no scope as `invalid-request`, so `resolveSource` receives only the declared scopes.
- `ScopeName<typeof catalog>` is the union of the scopes, and `PresetName<typeof catalog>` is the union of the preset names.

## Resolve sources

The catalog of the server types the scopes `resolveSource` receives, so it handles each of them:

```ts
// server/renditions.ts
const server = createRenditionServer({
  catalog,
  // source, results and processor as in Getting Started
  resolveSource({ scope, path }, { tenant }: { tenant: string }) {
    return { sourceKey: scope === "tenant" ? `tenants/${tenant}/${path}` : `shared/${path}` }
  },
})

export default defineRenditionEventHandler({
  server,
  // findTenant() is your lookup, for example by host.
  getContext: async event => ({ tenant: await findTenant(event) }),
})
```

- The handler calls `getContext` at most once per request.
  It skips the call for a method other than `GET` and `HEAD`, and, unless `onFailure` is set, for a malformed URL or a scope the catalog does not declare.
- If `resolveSource` returns `undefined`, the request fails with `404`.
- Without scopes in the catalog, targets have no scope, and the server rejects a target with one as `invalid-request`.
- Map different scopes to different keys even for equal paths.
- To define `resolveSource` apart from the server, for example to test it, type it as `SourceResolver<Context, ScopeName<typeof catalog>>` from `image-renditions/server`.
- A rendition is stored in the result store at `<sourceKey>/<hash>.<extension>`.
  To keep renditions in the bucket of uploads, pass a `prefix` to [`createS3Results()`](./storage#s3-storage).
  To lay them out per source, for example in the folder of each tenant, also return a `renditionPrefix` that no source key starts with, to use instead of `sourceKey`.
- S3 limits a key to 1024 bytes in UTF-8, and the library writes a rendition under a key up to 18 bytes longer than its rendition prefix, plus the `prefix` of the store and a slash.
  If source keys can come that close to the limit, return a shorter `renditionPrefix`, or their renditions fail as `invalid-request`.

Derive the context from the URL only, host included, for example from the tenant's domain: browsers and CDNs cache the redirect to a rendition by its URL for a day.
If the context depends on cookies or a session, pass `redirectCacheControl: "no-store"` to `defineRenditionEventHandler()`, or one tenant may get the rendition of another.

## Scopes in Nuxt

With the Nuxt module, `defaultScope: "tenant"` makes `tenant` the scope of every image, and `scope` selects another one; the build fails unless the catalog declares the default scope:

```vue
<RenditionImg preset="cover" :src="template.coverPath" scope="shared" alt="" />
```
