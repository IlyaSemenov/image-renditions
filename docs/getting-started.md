# Getting Started

image-renditions renders images on their first request and stores each result in your S3 bucket or a directory.
With an S3 bucket, or a directory that outlives deploys and is shared by every replica, app servers keep no image files: renditions survive redeploys, and any replica serves any of them.

The library is modular, with pluggable parts:

- [HTTP](./frameworks): an event handler for h3 1.15 or newer and h3 2, and a framework-neutral handler for other servers.
- [Processing](./processing): a processor built on sharp.
- [Storage](./storage): an S3 bucket or a file system directory for uploads, with renditions in another one, in a [folder of their own](./storage#s3-storage), or [next to each upload](./scopes).
- [Nuxt](#quick-start): a Nuxt 4 module that registers the handler and the `<RenditionImg>` component.
- [Replicas](./replicas): a readiness index and a lock shared between replicas through Redis.
- [Extending](./extending): other storage, image libraries, and state shared between replicas plug in through the interfaces of `image-renditions/server`.

## When not to use it

Use an image service such as [imgproxy](https://imgproxy.net) or [Thumbor](https://thumbor.readthedocs.io) when the URL must choose the size, such as `?w=300`.
Such a service takes the size and other options from the URL, and to keep clients from changing them it can require URLs signed with a secret key, which must stay out of browser code.

image-renditions renders only the presets of its catalog: a URL carries a hash of the preset options, and a request for any other hash renders nothing.
Its URLs need no secret, so they can be built in the browser too, but every size must be a preset in your code.

## Quick start

This example sets up image-renditions in a Nuxt app.

```sh
npm install image-renditions sharp
```

`sharp` is needed by the built-in [processor](./processing).

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
import { S3Client } from "@aws-sdk/client-s3"
import { defineRenditionEventHandler } from "image-renditions/h3"
import { createS3Results, createS3Source } from "image-renditions/s3"
import { createRenditionServer } from "image-renditions/server"
import { createSharpProcessor } from "image-renditions/sharp"

import catalog from "#shared/renditions"

const client = new S3Client({ region: "us-east-1" })

const server = createRenditionServer({
  catalog,
  source: createS3Source({ client, bucket: "uploads" }),
  results: createS3Results({
    client,
    bucket: "renditions",
    publicUrl: "https://renditions.example.com",
  }),
  processor: createSharpProcessor(),
})

export default defineRenditionEventHandler({ server })
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

Without Nuxt, mount the handler in [h3 or another framework](./frameworks) and build URLs with the [catalog](./showing-images#without-nuxt).

## What's next

- Choose sizes, formats and quality: [Presets](./presets).
- Render images in components and code: [Showing Images](./showing-images).
- Serve uploads of several tenants: [Scopes](./scopes).
- Show SVG and other sources as they are: [Originals](./originals).
- Keep GIF and WebP animations: [Animation](./animation).
- Keep renditions on a disk instead of S3: [Storage](./storage#file-storage).
- Run several replicas: [Multiple Replicas](./replicas).
- Report or replace failure responses: [Errors](./errors).
