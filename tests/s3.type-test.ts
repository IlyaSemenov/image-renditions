import type { S3, S3Client } from "@aws-sdk/client-s3"
import type { S3SourceOptions } from "image-renditions/s3"

// The bare and the aggregated client of AWS SDK v3 work with the S3 stores.
export const clients: S3SourceOptions["client"][] = [{} as S3Client, {} as S3]
