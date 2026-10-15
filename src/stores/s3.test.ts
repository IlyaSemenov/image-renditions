import { describe, expect, mock, test } from "bun:test"

import {
  GetObjectCommand,
  type GetObjectCommandInput,
  HeadObjectCommand,
  type HeadObjectCommandInput,
  PutObjectCommand,
  type PutObjectCommandInput,
  type S3Client,
} from "@aws-sdk/client-s3"

import { RenditionError } from "../server/error"

import { createS3Results, createS3Source } from "./s3"

const signal = new AbortController().signal

function createNotFoundError(name: string) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } })
}

function createBody(...chunks: Uint8Array[]) {
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

/** Handlers of the commands the S3 stores send, called with the input and options of each. */
interface CommandHandlers {
  getObject(input: GetObjectCommandInput, options?: { abortSignal?: AbortSignal }): Promise<unknown>
  headObject(
    input: HeadObjectCommandInput,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>
  putObject(input: PutObjectCommandInput, options?: { abortSignal?: AbortSignal }): Promise<unknown>
}

/** Creates a client that passes each command to its handler, failing commands without one. */
function createClient(overrides: Partial<CommandHandlers>) {
  const unexpected = () => Promise.reject(new Error("Unexpected call."))
  const { getObject = unexpected, headObject = unexpected, putObject = unexpected } = overrides
  function send(command: unknown, options?: { abortSignal?: AbortSignal }) {
    if (command instanceof GetObjectCommand) {
      return getObject(command.input, options)
    }
    if (command instanceof HeadObjectCommand) {
      return headObject(command.input, options)
    }
    if (command instanceof PutObjectCommand) {
      return putObject(command.input, options)
    }
    return unexpected()
  }
  // The stores call `send` with one command and options, which the SDK overloads accept among others.
  return { send } as unknown as Pick<S3Client, "send">
}

describe("source", () => {
  test("reads an object and reports a missing one as absent", async () => {
    const source = createS3Source({
      bucket: "b",
      client: createClient({
        getObject: async ({ Key }) => {
          if (Key !== "a.jpg") {
            throw createNotFoundError("NoSuchKey")
          }
          return { ContentLength: 2, Body: createBody(new Uint8Array([1]), new Uint8Array([2])) }
        },
      }),
    })

    expect(await source.read("a.jpg", { signal })).toEqual(new Uint8Array([1, 2]))
    expect(await source.read("missing.jpg", { signal })).toBeUndefined()
  })

  test("rejects objects above the size limit without reading their body", async () => {
    const transformToWebStream = mock(createBody(new Uint8Array(10)).transformToWebStream)
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

    expect((failure as RenditionError).reason).toBe("source-too-large")
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

      expect((failure as RenditionError).reason).toBe("source-too-large")
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
      client: createClient({
        getObject: () => Promise.reject(createNotFoundError("NoSuchBucket")),
      }),
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
            throw createNotFoundError("NotFound")
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

  describe("prefix", () => {
    test("keeps objects and their URLs under the prefix", async () => {
      const headObject = mock(async () => ({}))
      const putObject = mock(async () => ({}))
      const results = createS3Results({
        bucket: "b",
        publicUrl: "https://storage.test/b",
        prefix: "ф/renditions",
        client: createClient({ headObject, putObject }),
      })

      expect(await results.exists("k.avif", { signal })).toBe(true)
      await results.write(
        "k.avif",
        { data: new Uint8Array([1]), contentType: "image/avif" },
        { signal },
      )

      expect(headObject).toHaveBeenCalledWith(
        { Bucket: "b", Key: "ф/renditions/k.avif" },
        { abortSignal: signal },
      )
      expect(putObject).toHaveBeenCalledWith(
        expect.objectContaining({ Key: "ф/renditions/k.avif" }),
        { abortSignal: signal },
      )
      expect(results.url("a b.avif")).toBe("https://storage.test/b/%D1%84/renditions/a%20b.avif")
    })

    test("counts the prefix and its slash toward the S3 limit", async () => {
      const results = createS3Results({
        bucket: "b",
        publicUrl: "https://storage.test/b",
        // A Cyrillic letter takes two bytes, so with the slash the prefix takes three.
        prefix: "ф",
        client: createClient({ headObject: async () => ({}) }),
      })

      expect(await results.exists("a".repeat(1021), { signal })).toBe(true)
      const failure = await results.exists("a".repeat(1022), { signal }).catch(error => error)
      expect((failure as RenditionError).reason).toBe("invalid-request")
    })

    test("rejects a prefix that is not a valid key", () => {
      for (const prefix of ["", "/renditions", "renditions/", "a//b", "a/../b"]) {
        expect(() =>
          createS3Results({
            bucket: "b",
            publicUrl: "https://s.test",
            prefix,
            client: createClient({}),
          }),
        ).toThrow(`Invalid S3 key prefix "${prefix}".`)
      }
    })
  })
})
