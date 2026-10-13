# image-renditions

Resize and re-encode uploaded images when a page first shows them, store each result in your S3 bucket or a directory, and serve it from there.

```vue
<RenditionImg preset="avatar" src="avatars/42.jpg" alt="" />
```

```html
<img
  src="/_renditions/v1/avatar.faf7e221f65dd97945e352a57e805252.avif/avatars/42.jpg"
  srcset="
    /_renditions/v1/avatar.faf7e221f65dd97945e352a57e805252.avif/avatars/42.jpg    1x,
    /_renditions/v1/avatar@2x.b62b90cf6c3ed57e4c1c27da0c36d778.avif/avatars/42.jpg 2x
  "
  alt=""
/>
```

- The first request for such a URL renders a 48×48 AVIF from `avatars/42.jpg`, writes it to storage, and redirects the browser to the stored file.
- Later requests redirect at once, and your bucket or CDN serves the image.
- Changing the `avatar` preset gives it new URLs, so no browser or CDN keeps showing the old version.

App servers keep no image files: renditions stay in storage across redeploys, and any replica serves any of them.

The h3 handler supports h3 1.15 or newer and h3 2, and the Nuxt module requires Nuxt 4.

## When not to use it

- The URL must choose the size, such as `?w=300`.
  Here every size is a preset in your code.
- Image processing must not share CPU with your app.
  Here images are processed inside the app process; a separate image service, such as imgproxy, or a hosted one, such as Cloudflare Images, takes that load elsewhere.

## Quick start

This example sets up image-renditions in a Nuxt app.

```sh
npm install image-renditions sharp
```

`sharp` is needed by the built-in [processor](#processing).

Define presets in a catalog.
Both the app and the server import it, so it must import nothing but `image-renditions`:

```ts
// shared/renditions.ts
import { defineCatalog } from "image-renditions"

export default defineCatalog({
  presets: {
    // 48×48 for regular screens and 96×96 for high-density ones.
    avatar: { width: 48, height: 48, densities: [1, 2] },
    cover: { width: 800, height: 200 },
  },
})
```

Create a handler for rendition URLs, for example one that reads uploads from the `uploads` bucket and writes renditions to the public `renditions` bucket:

```ts
// server/renditions.ts
import { S3 } from "@aws-sdk/client-s3"
import { defineRenditionEventHandler } from "image-renditions/h3"
import { createS3Results, createS3Source } from "image-renditions/s3"
import { createRenditionServer } from "image-renditions/server"
import { createSharpProcessor } from "image-renditions/sharp"

import catalog from "#shared/renditions"

const client = new S3({ region: "us-east-1" })

const server = createRenditionServer({
  source: createS3Source({ client, bucket: "uploads" }),
  results: createS3Results({
    client,
    bucket: "renditions",
    publicUrl: "https://renditions.example.com",
  }),
  processor: createSharpProcessor(),
})

export default defineRenditionEventHandler({ catalog, server })
```

A rendition of `avatars/42.jpg` is stored in `renditions` at `avatars/42.jpg/<hash>.avif`, and `publicUrl` is where browsers load it from.

Register the catalog and the handler:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["image-renditions/nuxt"],
  renditions: {
    catalog: "#shared/renditions",
    handler: "~~/server/renditions",
  },
})
```

Show images:

```vue
<!-- app/components/UserAvatar.vue -->
<template>
  <RenditionImg preset="avatar" :src="user.avatarPath" alt="" />
</template>
```

`user.avatarPath` is the key of the upload in its bucket, such as `avatars/42.jpg`.
Preset names are type-checked against the catalog.

## Presets

Options of a preset, or of `defaults`, which every preset overrides field by field:

- `width`, `height` — size in CSS pixels at density 1; with one side set, the other keeps the aspect ratio.
- `fit` — how the image fills the box when both sides are set:
  - `cover` (default) crops what overflows the box.
  - `contain` letterboxes the image inside the box.
  - `fill` stretches the image to the box.
  - `inside` and `outside` keep the aspect ratio, so one side of the output is smaller or larger than the box.
- `position` — `center` (default), `top`, `bottom`, `left`, `right`, or content-aware `entropy` and `attention` for `cover`.
- `enlarge` — upscale sources smaller than the target; otherwise they keep their size.
- `background` — hex color for `contain` letterboxing, transparent by default, and for flattening transparency into JPEG, white by default.
- `format` — `avif` (default), `webp`, `jpeg` or `png`.
- `quality` — encoder quality from 1 to 100, by default 50 for `avif` and 80 for `webp` and `jpeg`; `png` is lossless.
- `effort` — CPU effort of the `avif` (0–9) and `webp` (0–6) encoders, 4 by default.
- `densities` — pixel densities to render, `[1]` by default.

Options of the catalog:

- `basePath` — path the handler is mounted at, `/_renditions` by default.
- `pipelineVersion` — bump it to render every image again, for example after switching to another processor.

Changing an option that affects the output gives the images of the preset new URLs, and they are rendered again on their first request.
Renaming a preset keeps its stored renditions.

## Showing images

`<RenditionImg>` renders `src`, and a `srcset` when the preset has several densities.

- It also renders `width` and `height` when the image always has the preset size: with `contain`, or with `cover` and `fill` when `enlarge` is set.
  Otherwise a small source keeps its own size, so size such images with CSS.
- A `src` that is already a URL, such as `blob:` or `https:`, renders unchanged, for example a preview of a file being uploaded.
- A path no rendition URL can address, such as one with a `..` segment, renders no `src` instead of breaking the page.

`useRenditions()` builds the same URLs in code, prefixed with `app.baseURL`:

```ts
const renditions = useRenditions()

renditions.url("cover", post.coverPath)
renditions.url("avatar", path, { density: 2 })
renditions.srcset("avatar", path)
renditions.attrs("avatar", path) // attributes <RenditionImg> renders, for your own img element
```

Module options, under `renditions`:

- `catalog` — module exporting the catalog by default; required.
- `handler` — optional module exporting the h3 handler by default, mounted at the catalog base path.
- `defaultScope` — optional [scope](#scopes) for `<RenditionImg>` and `useRenditions()`.

## Scopes

The path an app stores for an upload, such as `avatars/42.jpg`, is often not its storage key.
Each tenant may keep its uploads under its own prefix, and some files may be shared by all tenants, so the same path can mean different files.

Scopes and `resolveSource` let the server decide where a path lives:

- The scope tells which space a path belongs to, such as `tenant` or `shared`.
  One page may show images of several spaces, so each URL carries its scope.
- The context holds what the request determines, such as the current tenant; `getContext` derives it from the request, so a client cannot change it by editing a URL.
- `resolveSource` maps the scope, the path and the context to storage keys, or rejects them.

Without `resolveSource`, an unscoped path is the key itself, and scoped paths are rejected.

For example, with uploads of several tenants and files shared between them:

```ts
// server/renditions.ts
const server = createRenditionServer<{ tenant: string }>({
  // source, results and processor as in the quick start
  resolveSource({ scope, path }, { tenant }) {
    if (scope === "tenant") {
      return { sourceKey: `tenants/${tenant}/${path}` }
    }
    if (scope === "shared") {
      return { sourceKey: `shared/${path}` }
    }
    return undefined
  },
})

export default defineRenditionEventHandler({
  catalog,
  server,
  // findTenant() is your lookup, for example by host.
  getContext: async event => ({ tenant: await findTenant(event) }),
})
```

- If `resolveSource` returns `undefined`, the request fails with `404`.
- `resolveSource` receives unscoped paths too, with an undefined `scope`.
- Map different scopes to different keys even for equal paths.
- A rendition is stored in the result store at `<sourceKey>/<hash>.<extension>`.
  To keep renditions in the bucket of uploads, also return a `resultPrefix` that no source key starts with, such as `` `renditions/${sourceKey}` ``, to use instead of `sourceKey`.

With the Nuxt module, `defaultScope: "tenant"` makes `tenant` the scope of every image, and `scope` selects another one:

```vue
<RenditionImg preset="cover" :src="template.coverPath" scope="shared" alt="" />
```

## Storage

The server reads sources from a source store and writes renditions to a result store, which may be of different kinds.
Both source stores fail sources larger than 50 MiB as unsupported; pass `maxBytes` to `createS3Source()` or `createFileSystemSource()` to change the limit.

### S3 storage

To keep uploads and renditions in S3 buckets, use the stores of `image-renditions/s3`:

```ts
// server/renditions.ts
import { S3 } from "@aws-sdk/client-s3"
import { createS3Results, createS3Source } from "image-renditions/s3"

const client = new S3({ region: "us-east-1" })

const server = createRenditionServer({
  source: createS3Source({ client, bucket: "uploads" }),
  results: createS3Results({
    client,
    bucket: "renditions",
    publicUrl: "https://renditions.example.com",
  }),
  processor: createSharpProcessor(),
})
```

The stores take the aggregated `S3` client of AWS SDK v3 or any object with its `getObject`, `headObject` and `putObject` methods.
`createS3Results()` writes renditions with `Cache-Control: public, max-age=31536000, immutable`; pass it `cacheControl` to change the header.
The bucket of renditions must serve them publicly at `publicUrl`, directly or through a CDN.

### File storage

To keep uploads and renditions on a disk served by a web server, use the stores of `image-renditions/fs`:

```ts
// server/renditions.ts
import { createFileSystemResults, createFileSystemSource } from "image-renditions/fs"

const server = createRenditionServer({
  source: createFileSystemSource({ root: "/data/uploads" }),
  results: createFileSystemResults({ root: "/data/renditions", publicUrl: "/renditions" }),
  processor: createSharpProcessor(),
})
```

```nginx
location /renditions/ {
  alias /data/renditions/;
  add_header Cache-Control "public, max-age=31536000, immutable";
}
```

## Processing

`createSharpProcessor()` from `image-renditions/sharp` processes images with [sharp](https://sharp.pixelplumbing.com).
Sources over 100 megapixels fail as unsupported; pass `maxInputPixels` to `createSharpProcessor()` to change the limit.

To process images with another library, implement the [`Processor`](#extending) interface and pass your implementation to `createRenditionServer()` as `processor`.

## h3 and other frameworks

The handler from the quick start is a regular h3 event handler.
Mount it at `<basePath>/**`, `/_renditions/**` by default:

```ts
// server.ts
import { H3, serve } from "h3"

import renditions from "./renditions"

serve(new H3().all("/_renditions/**", renditions))
```

With h3 v1, add it to a router: `createRouter().use("/_renditions/**", renditions)`.

For other frameworks, use `createRenditionHandler()` from `image-renditions/server`.
It takes the same options without `getContext` and returns a function from the request and the context to a `Response`, for example in a fetch handler:

```ts
// server.ts
import { createRenditionHandler } from "image-renditions/server"

const renditions = createRenditionHandler({ catalog, server })

export default {
  fetch(request: Request) {
    const { pathname, search } = new URL(request.url)
    // The second argument is the context resolveSource receives, such as the current tenant.
    return renditions({ method: request.method, path: pathname + search }, undefined)
  },
}
```

Build URLs in the app with the catalog, which is safe to import in browsers:

```ts
catalog.url("avatar", { path: "avatars/42.jpg" })
// /_renditions/v1/avatar.faf7e221f65dd97945e352a57e805252.avif/avatars/42.jpg

catalog.srcset("avatar", { scope: "tenant", path: "avatars/42.jpg" })
```

## Rendering outside requests

`server.ensure()` publishes one density of a preset without a request, for example right after an upload:

```ts
for (const { recipe } of catalog.variants("avatar")) {
  await server.ensure(recipe, { scope: "tenant", path: "avatars/42.jpg" }, { tenant: "acme" })
}
```

It resolves to the key and public URL of the rendition after it is written or found in storage.

## How a request is served

```text
/_renditions/v1/[<scope>/]<preset>.<hash>.<extension>/<path>
```

The hash identifies the preset options at one density, and the preset name only labels the URL.
The handler looks up the hash in the catalog, resolves the source, and then:

1. If the process or a shared readiness index remembers the rendition, it redirects right away.
2. Otherwise it checks storage and redirects if the rendition is there.
3. Otherwise it reads the source, renders it, writes the result, and redirects.

Within a process, equal concurrent requests are rendered once.
Replicas without a shared `coordinator` may each render the same rendition and write equal files under its key.

The redirect is a `307` with `Cache-Control: public, max-age=86400`, so browsers and CDNs remember it for a day.
It points to the storage URL built from `publicUrl`, and a cached redirect cannot be revoked: after you move renditions to another domain, clients follow the old redirects until they expire.
If `publicUrl` never changes, pass a longer `redirectCacheControl` to `defineRenditionEventHandler()`.

## Concurrency and timeouts

Rendering takes the CPU and memory of the app process, so the `limits` option of `createRenditionServer()` bounds it per process:

- `concurrency` — renditions processed at once, 2 by default.
- `queueSize` — renditions waiting for a slot, 100 by default.
- `queueTimeout` — milliseconds a rendition may wait for a slot, 30 seconds by default.
- `storageTimeout` — milliseconds a storage call may take, 15 seconds by default.

Requests beyond the queue, or waiting too long, fail as `overloaded`.
Processing itself has no timeout, because a timeout could not stop the processor and free its slot.

## Errors

| Reason               | Status | Meaning                                                                         |
| -------------------- | ------ | ------------------------------------------------------------------------------- |
| `invalid-request`    | 404    | Malformed URL, or `resolveSource` rejected the target or returned an unsafe key |
| `unknown-recipe`     | 404    | Hash neither in the catalog nor known as published                              |
| `source-not-found`   | 404    | No source under the resolved key                                                |
| `unsupported-source` | 422    | Source cannot be decoded or exceeds a size limit                                |
| `source-error`       | 502    | Reading the source failed                                                       |
| `processing-failed`  | 500    | Encoding failed                                                                 |
| `storage-error`      | 502    | Checking for or writing the rendition failed                                    |
| `overloaded`         | 503    | Processing queue is full or the wait timed out                                  |

### Outdated URLs

A page rendered before a preset changed keeps requesting the old hash, which the catalog no longer has.
The handler serves it while the process or a shared readiness index remembers its rendition.
Otherwise the request fails as `unknown-recipe` without calling the stores, so made-up hashes cause no storage traffic either.

### Custom responses

`onFailure` can report a failure or replace the response, for example with the original image:

```ts
export default defineRenditionEventHandler({
  catalog,
  server,
  getContext,
  onFailure({ reason, error, address }) {
    if (reason === "storage-error" || reason === "processing-failed") {
      reportError(error)
    }
    if (reason === "unknown-recipe" && address) {
      // originalUrl() is your absolute URL of the uploaded file.
      return Response.redirect(originalUrl(address.path), 302)
    }
    return undefined
  },
})
```

Returning `undefined` keeps the default response.
Every failure response, including a replaced one, is sent with `Cache-Control: no-store`.

## Extending

Implement an interface from `image-renditions/server` and pass your implementation to `createRenditionServer()`:

- To use other storage, implement `SourceStore` or `ResultStore` and pass it as `source` or `results`.
- To process images with another library, implement `Processor` and pass it as `processor`.
- To share the index of published renditions between replicas, for example in Redis, implement `ReadinessIndex` and pass it as `readiness.shared`.
  If it fails, the server reports the error to `onError` and checks storage instead.
- To render each rendition once across replicas, implement `Coordinator` as a shared lock and pass it as `coordinator`.

The built-in stores and processor implement the same interfaces and serve as examples.

## Limitations

- Renditions are public, and anyone who knows a path that `resolveSource` serves can get its renditions.
  Keep private images out of what `resolveSource` maps, for example by serving only the folders of public images.
- A source must never change under its key: renditions of a replaced source keep showing the old image.
  Store new content under a new key.
- Deleting a source leaves its renditions in storage under its result prefix.
- Animated sources render their first frame, SVG sources are rasterized at the target size, and EXIF orientation is applied.
- Source paths are limited to 1024 characters.
