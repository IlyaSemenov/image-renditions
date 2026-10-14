import type { SourceResolution } from "./server"

/** Why a rendition could not be served. */
export type RenditionFailureReason =
  /** The URL is malformed, the source resolver rejected its target, or a key is unsafe or too long for the store. */
  | "invalid-request"
  /** The recipe hash is not in the catalog, and no rendition with it is known to be published. */
  | "unknown-recipe"
  | "source-not-found"
  /** The source cannot be decoded or processed. */
  | "unsupported-source"
  /** The source exceeds a byte or pixel limit. */
  | "source-too-large"
  /** Reading the source failed for a reason other than its absence. */
  | "source-error"
  /** Processing failed for a reason other than the source. */
  | "processing-failed"
  /** Checking for or writing the result in storage failed. */
  | "storage-error"
  /** The processing queue is full, or a request waited in it for too long. */
  | "overloaded"

/** Options of a {@link RenditionError}. */
export interface RenditionErrorOptions extends ErrorOptions {
  source?: Readonly<Required<SourceResolution>>
}

/** Failure of a rendition operation, with a reason a failure policy can tell apart. */
export class RenditionError extends Error {
  override name = "RenditionError"
  /** Keys of the target, present when the failure happened after the server resolved them and checked that they are safe; the source need not exist. */
  readonly source?: Readonly<Required<SourceResolution>>

  constructor(
    readonly reason: RenditionFailureReason,
    message: string = reason,
    options?: RenditionErrorOptions,
  ) {
    super(message, options)
    this.source = options?.source
  }
}
