import type { S3 } from "@aws-sdk/client-s3"
import type { S3ClientLike } from "image-renditions/s3"

// The aggregated AWS SDK v3 client works with the S3 stores without a wrapper.
export const client = {} as S3 satisfies S3ClientLike
