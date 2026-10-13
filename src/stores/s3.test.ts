import { describe, expect, mock, test } from "bun:test"

import { RenditionError } from "../server/error"

import { createS3Results, createS3Source, type S3ClientLike } from "./s3"

const signal = new AbortController().signal

function notFound(name: string) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } })
}

function body(...chunks: Uint8Array[]) {
  return {
    transformToWebStream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          chunks.forEach(chunk => controller.enqueue(chunk))
          controller.close()
        },
      }),
  }
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
          return { ContentLength: 2, Body: body(new Uint8Array([1]), new Uint8Array([2])) }
        },
      }),
    })

    expect(await source.read("a.jpg", { signal })).toEqual(new Uint8Array([1, 2]))
    expect(await source.read("missing.jpg", { signal })).toBeUndefined()
  })

  test("rejects objects above the size limit without reading their body", async () => {
    const transformToWebStream = mock(body(new Uint8Array(10)).transformToWebStream)
    let abortSignal: AbortSignal | undefined
    const source = createS3Source({
      bucket: "b",
      maxBytes: 5,
      client: createClient({
        getObject: async (_, options) => {
          abortSignal = options?.abortSignal
          return { ContentLength: 10, Body: { transformToWebStream } }
        },
      }),
    })

    const failure = await source.read("big.jpg", { signal }).catch((error: unknown) => error)

    expect((failure as RenditionError).reason).toBe("unsupported-source")
    expect(transformToWebStream).not.toHaveBeenCalled()
    expect(abortSignal?.aborted).toBe(true)
  })

  test.each([
    ["hangs", () => new Promise<void>(() => {})],
    ["fails", () => Promise.reject(new Error("Cancellation failed."))],
  ])(
    "stops reading an object of unknown length above the size limit even if cancelling it %s",
    async (_, cancel) => {
      let pulls = 0
      const cancelStream = mock(cancel)
      let abortSignal: AbortSignal | undefined
      const source = createS3Source({
        bucket: "b",
        maxBytes: 10,
        client: createClient({
          getObject: async (_, options) => {
            abortSignal = options?.abortSignal
            const stream = new ReadableStream<Uint8Array>(
              {
                pull(controller) {
                  pulls++
                  controller.enqueue(new Uint8Array(4))
                },
                cancel: cancelStream,
              },
              { highWaterMark: 0 },
            )
            return { Body: { transformToWebStream: () => stream } }
          },
        }),
      })

      const failure = await source.read("big.jpg", { signal }).catch((error: unknown) => error)

      expect((failure as RenditionError).reason).toBe("unsupported-source")
      expect(pulls).toBe(3)
      expect(cancelStream).toHaveBeenCalled()
      expect(abortSignal?.aborted).toBe(true)
    },
  )

  test("reports an object under a key beyond the S3 limit as absent without requesting it", async () => {
    const source = createS3Source({ bucket: "b", client: createClient({}) })

    expect(await source.read("ф".repeat(513), { signal })).toBeUndefined()
  })

  test("propagates errors other than absence", async () => {
    const source = createS3Source({
      bucket: "b",
      client: createClient({ getObject: () => Promise.reject(new Error("Access denied.")) }),
    })

    await expect(source.read("a.jpg", { signal })).rejects.toThrow("Access denied.")
  })

  test("propagates a missing bucket instead of reporting the object as absent", async () => {
    const source = createS3Source({
      bucket: "b",
      client: createClient({ getObject: () => Promise.reject(notFound("NoSuchBucket")) }),
    })

    await expect(source.read("a.jpg", { signal })).rejects.toThrow("NoSuchBucket")
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

  test("rejects a key beyond the S3 limit without a request", async () => {
    const results = createS3Results({
      bucket: "b",
      publicUrl: "https://storage.test/b",
      client: createClient({}),
    })
    // Cyrillic letters take two bytes each, so the key fits in characters but not in bytes.
    const key = "ф".repeat(513)
    const image = { data: new Uint8Array([1]), contentType: "image/avif" }

    const failures = await Promise.all([
      results.exists(key, { signal }).catch((error: unknown) => error),
      results.write(key, image, { signal }).catch((error: unknown) => error),
    ])

    expect(failures.map(failure => (failure as RenditionError).reason)).toEqual([
      "invalid-request",
      "invalid-request",
    ])
  })
})
