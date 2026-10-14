/** Encoded rendition ready to be stored. */
export interface EncodedImage {
  data: Uint8Array
  /** MIME type of `data`, such as `image/avif`. */
  contentType: string
}

/** Options of a single storage call. */
export interface StoreCallOptions {
  /** Aborts the call when the operation times out. */
  signal: AbortSignal
}

/**
 * Storage of immutable source images.
 *
 * Sources are assumed never to change under the same key: a rendition is generated once and is not refreshed.
 */
export interface SourceStore {
  /**
   * Reads a source object.
   *
   * Resolves to `undefined` when the object does not exist.
   * Rejects with a `RenditionError` of reason `source-too-large` when the object exceeds a size limit.
   */
  read(key: string, options: StoreCallOptions): Promise<Uint8Array | undefined>
}

/** Storage of published renditions, each served from a public URL. */
export interface ResultStore {
  /** Checks whether an object is published under the key. */
  exists(key: string, options: StoreCallOptions): Promise<boolean>
  /**
   * Publishes an object under the key.
   *
   * Overwriting an existing object with an equivalent rendition must be safe, because concurrent replicas may render the same key.
   * Readers must never observe a partially written object.
   */
  write(key: string, image: EncodedImage, options: StoreCallOptions): Promise<void>
  /** Public URL of the object under the key, percent-encoded so it can be sent in a `Location` header. */
  url(key: string): string
}
