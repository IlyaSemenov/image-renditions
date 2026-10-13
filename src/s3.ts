import { encodePath } from "./path"
import { RenditionError } from "./server/error"
import type { ResultStore, SourceStore } from "./server/stores"

/** Per-call options of the S3 client methods. */
interface S3CallOptions {
  abortSignal?: AbortSignal
}

/** Location of an S3 object. */
interface S3ObjectInput {
  Bucket: string
  Key: string
}

/**
 * Subset of an S3 client used by the S3 stores.
 *
 * The aggregated `S3` client of AWS SDK v3 (`@aws-sdk/client-s3`) satisfies it as is; other clients need a thin wrapper.
 */
export interface S3ClientLike {
  getObject(
    input: S3ObjectInput,
    options?: S3CallOptions,
  ): Promise<{ Body?: { transformToByteArray(): Promise<Uint8Array> }; ContentLength?: number }>
  headObject(input: S3ObjectInput, options?: S3CallOptions): Promise<unknown>
  putObject(
    input: S3ObjectInput & { Body: Uint8Array; ContentType: string; CacheControl: string },
    options?: S3CallOptions,
  ): Promise<unknown>
}

/** Options of {@link createS3Source}. */
export interface S3SourceOptions {
  client: S3ClientLike
  bucket: string
  /** Largest source object, in bytes; larger sources are unsupported. */
  maxBytes?: number
}

/** Options of {@link createS3Results}. */
export interface S3ResultsOptions {
  client: S3ClientLike
  bucket: string
  /** Public URL of the bucket root, such as `https://storage.example.com/bucket`; objects must be publicly readable. */
  publicUrl: string
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
      const controller = new AbortController()
      const output = await client
        .getObject(
          { Bucket: bucket, Key: key },
          { abortSignal: AbortSignal.any([signal, controller.signal]) },
        )
        .catch(ignoreNotFound)
      if (!output?.Body) {
        return undefined
      }
      const tooLarge = new RenditionError(
        "unsupported-source",
        `The source ${key} exceeds ${maxBytes} bytes.`,
      )
      if ((output.ContentLength ?? 0) > maxBytes) {
        // Aborting releases the connection instead of downloading a body that is never used.
        controller.abort()
        throw tooLarge
      }
      // A client may omit the length, so the limit is also checked on the downloaded body.
      const data = await output.Body.transformToByteArray()
      if (data.byteLength > maxBytes) {
        throw tooLarge
      }
      return data
    },
  }
}

/** Creates a result store writing objects to an S3 bucket that serves them publicly. */
export function createS3Results({
  client,
  bucket,
  publicUrl,
  cacheControl = "public, max-age=31536000, immutable",
}: S3ResultsOptions): ResultStore {
  return {
    async exists(key, { signal }) {
      const output = await client
        .headObject({ Bucket: bucket, Key: key }, { abortSignal: signal })
        .catch(ignoreNotFound)
      return output !== undefined
    },
    async write(key, { data, contentType }, { signal }) {
      await client.putObject(
        {
          Bucket: bucket,
          Key: key,
          Body: data,
          ContentType: contentType,
          CacheControl: cacheControl,
        },
        { abortSignal: signal },
      )
    },
    url: key => `${publicUrl.replace(/\/$/, "")}/${encodePath(key)}`,
  }
}

function ignoreNotFound(error: unknown): undefined {
  const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  if ($metadata?.httpStatusCode === 404 || name === "NoSuchKey" || name === "NotFound") {
    return undefined
  }
  throw error
}
