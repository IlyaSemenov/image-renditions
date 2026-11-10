# Storage

The server reads sources from a source store and writes renditions to a result store, which may be of different kinds.
Both source stores fail sources larger than 50 MiB as `source-too-large`; pass `maxBytes` to `createS3Source()` or `createFileSystemSource()` to change the limit.

## S3 storage

To keep uploads and renditions in S3 buckets, use the stores of `image-renditions/s3`:

```ts
// server/renditions.ts
import { S3Client } from "@aws-sdk/client-s3"
import { createS3Results, createS3Source } from "image-renditions/s3"

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
```

The stores take a client of AWS SDK v3, the bare `S3Client` or the aggregated `S3`.
`createS3Results()` writes renditions with `Cache-Control: public, max-age=31536000, immutable`; pass it `cacheControl` to change the header.
The bucket of renditions must serve them publicly at `publicUrl`, directly or through a CDN.

To keep renditions in the bucket of uploads, pass `createS3Results()` a `prefix` folder that holds no uploads, such as `renditions`.
Renditions are then stored and served under it, and `publicUrl` stays the URL of the bucket root.

## File storage

To keep uploads and renditions on a disk served by a web server, use the stores of `image-renditions/fs`:

```ts
// server/renditions.ts
import { createFileSystemResults, createFileSystemSource } from "image-renditions/fs"

const server = createRenditionServer({
  catalog,
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

To use other storage, implement the [`SourceStore` or `ResultStore`](./extending) interface.
