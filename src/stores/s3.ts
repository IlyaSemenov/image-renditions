import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3"

import { encodePath, isSafePath } from "../path"
import { RenditionError } from "../server/error"
import type { ResultStore, SourceStore } from "../server/stores"

/** Longest S3 object key, in UTF-8 bytes. */
const MAX_KEY_BYTES = 1024

const encoder = new TextEncoder()

/** Options of {@link createS3Source}. */
export interface S3SourceOptions {
  /** Client of AWS SDK v3, such as `S3Client` or the aggregated `S3`. */
  client: Pick<S3Client, "send">
  bucket: string
  /** Largest source object, in bytes; larger sources fail as too large. */
  maxBytes?: number
}

/** Options of {@link createS3Results}. */
export interface S3ResultsOptions {
  /** Client of AWS SDK v3, such as `S3Client` or the aggregated `S3`. */
  client: Pick<S3Client, "send">
  bucket: string
  /** Public URL of the bucket root, such as `https://storage.example.com/bucket`; objects must be publicly readable. */
  publicUrl: string
  /**
   * Folder of the bucket that holds the renditions, such as `renditions`.
   *
   * It lets renditions share a bucket with sources when no source key starts with it.
   */
  prefix?: string
  /** `Cache-Control` stored with each rendition; renditions never change, so they are immutable for a year by default. */
  cacheControl?: string
}

/** Creates a source store reading objects from an S3 bucket. */
export function createS3Source({
  client,
  bucket,
  maxBytes = 50 * 1024 * 1024,
}: S3SourceOptions): SourceStore {
  return {
    async read(key, { signal }) {
      // S3 holds no object under a longer key, so there is nothing to request.
      if (!fitsKeyLimit(key)) {
        return undefined
      }
      const controller = new AbortController()
      const output = await client
        .send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
          abortSignal: AbortSignal.any([signal, controller.signal]),
        })
        .catch(ignoreNotFound)
      if (!output?.Body) {
        return undefined
      }
      const tooLarge = new RenditionError(
        "source-too-large",
        `The source ${key} exceeds ${maxBytes} bytes.`,
      )
      if ((output.ContentLength ?? 0) > maxBytes) {
        // Aborting releases the connection instead of downloading a body that is never used.
        controller.abort()
        throw tooLarge
      }
      // A client may omit the length, so the limit is also enforced while the body is read.
      const reader = output.Body.transformToWebStream().getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        size += chunk.value.byteLength
        if (size > maxBytes) {
          controller.abort()
          // Cancellation is not awaited, so a stream that fails or hangs to cancel does not hold the failure.
          reader.cancel().catch(() => {})
          throw tooLarge
        }
        chunks.push(chunk.value)
      }
      const data = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.byteLength
      }
      return data
    },
  }
}

/**
 * Creates a result store writing objects to an S3 bucket that serves them publicly.
 *
 * @throws {RangeError} When `prefix` is not a valid key, such as one with a leading or trailing slash.
 */
export function createS3Results({
  client,
  bucket,
  publicUrl,
  prefix,
  cacheControl = "public, max-age=31536000, immutable",
}: S3ResultsOptions): ResultStore {
  if (prefix !== undefined && !isSafePath(prefix)) {
    throw new RangeError(`Invalid S3 key prefix "${prefix}".`)
  }
  const toObjectKey = (key: string) => (prefix === undefined ? key : `${prefix}/${key}`)
  return {
    async exists(key, { signal }) {
      const objectKey = toObjectKey(key)
      assertKeyLimit(objectKey)
      const output = await client
        .send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }), { abortSignal: signal })
        .catch(ignoreNotFound)
      return output !== undefined
    },
    async write(key, { data, contentType }, { signal }) {
      const objectKey = toObjectKey(key)
      assertKeyLimit(objectKey)
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: data,
          ContentType: contentType,
          CacheControl: cacheControl,
        }),
        { abortSignal: signal },
      )
    },
    url: key => `${publicUrl.replace(/\/$/, "")}/${encodePath(toObjectKey(key))}`,
  }
}

/** Checks a key against the S3 limit, which counts UTF-8 bytes rather than characters. */
function fitsKeyLimit(key: string) {
  return encoder.encode(key).byteLength <= MAX_KEY_BYTES
}

function assertKeyLimit(key: string) {
  if (!fitsKeyLimit(key)) {
    throw new RenditionError(
      "invalid-request",
      `The key ${key} exceeds the S3 limit of ${MAX_KEY_BYTES} bytes.`,
    )
  }
}

function ignoreNotFound(error: unknown): undefined {
  const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  // A missing bucket is a broken configuration rather than a missing object.
  // HEAD responses carry no error code, so `exists()` cannot tell the two apart.
  if (name === "NoSuchBucket") {
    throw error
  }
  if ($metadata?.httpStatusCode === 404 || name === "NoSuchKey" || name === "NotFound") {
    return undefined
  }
  throw error
}
