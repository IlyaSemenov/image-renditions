import { describe, expect, mock, test } from "bun:test"

import { createS3Results, createS3Source, type S3ClientLike } from "./s3"
import { RenditionError } from "./server/error"

const signal = new AbortController().signal

function notFound(name: string) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } })
}

function createClient(overrides: Partial<S3ClientLike>): S3ClientLike {
  const unexpected = () => Promise.reject(new Error("Unexpected call."))
  return { getObject: unexpected, headObject: unexpected, putObject: unexpected, ...overrides }
}

describe("source", () => {
  test("reads an object and reports a missing one as absent", async () => {
    const source = createS3Source({
      bucket: "b",
      client: createClient({
        getObject: async ({ Key }) => {
          if (Key !== "a.jpg") {
            throw notFound("NoSuchKey")
          }
          return {
            ContentLength: 2,
            Body: { transformToByteArray: async () => new Uint8Array([1, 2]) },
          }
        },
      }),
    })

    expect(await source.read("a.jpg", { signal })).toEqual(new Uint8Array([1, 2]))
    expect(await source.read("missing.jpg", { signal })).toBeUndefined()
  })

  test("rejects objects above the size limit without reading their body", async () => {
    const transformToByteArray = mock(async () => new Uint8Array(10))
    let abortSignal: AbortSignal | undefined
    const source = createS3Source({
      bucket: "b",
      maxBytes: 5,
      client: createClient({
        getObject: async (_, options) => {
          abortSignal = options?.abortSignal
          return { ContentLength: 10, Body: { transformToByteArray } }
        },
      }),
    })

    const failure = await source.read("big.jpg", { signal }).catch((error: unknown) => error)

    expect((failure as RenditionError).reason).toBe("unsupported-source")
    expect(transformToByteArray).not.toHaveBeenCalled()
    expect(abortSignal?.aborted).toBe(true)
  })

  test("rejects objects above the size limit when the client omits their length", async () => {
    const source = createS3Source({
      bucket: "b",
      maxBytes: 5,
      client: createClient({
        getObject: async () => ({ Body: { transformToByteArray: async () => new Uint8Array(10) } }),
      }),
    })

    const failure = await source.read("big.jpg", { signal }).catch((error: unknown) => error)

    expect((failure as RenditionError).reason).toBe("unsupported-source")
  })

  test("propagates errors other than absence", async () => {
    const source = createS3Source({
      bucket: "b",
      client: createClient({ getObject: () => Promise.reject(new Error("Access denied.")) }),
    })

    await expect(source.read("a.jpg", { signal })).rejects.toThrow("Access denied.")
  })
})

describe("results", () => {
  test("checks existence, stores the content type with an immutable cache policy and builds encoded URLs", async () => {
    const putObject = mock(async () => ({}))
    const results = createS3Results({
      bucket: "b",
      publicUrl: "https://storage.test/b/",
      client: createClient({
        headObject: async ({ Key }) => {
          if (Key !== "present.avif") {
            throw notFound("NotFound")
          }
          return {}
        },
        putObject,
      }),
    })

    expect(await results.exists("present.avif", { signal })).toBe(true)
    expect(await results.exists("absent.avif", { signal })).toBe(false)
    await results.write(
      "k.avif",
      { data: new Uint8Array([1]), contentType: "image/avif" },
      { signal },
    )
    expect(putObject).toHaveBeenCalledWith(
      {
        Bucket: "b",
        Key: "k.avif",
        Body: new Uint8Array([1]),
        ContentType: "image/avif",
        CacheControl: "public, max-age=31536000, immutable",
      },
      { abortSignal: signal },
    )
    expect(results.url("a b/ф.avif")).toBe("https://storage.test/b/a%20b/%D1%84.avif")
  })
})
