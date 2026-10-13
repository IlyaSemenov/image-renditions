import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createFileSystemResults, createFileSystemSource } from "./fs"
import { RenditionError } from "./server/error"

const signal = new AbortController().signal
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "image-renditions-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("source", () => {
  test("reads an existing file and reports a missing one as absent", async () => {
    await mkdir(join(root, "uploads"))
    await writeFile(join(root, "uploads/a.jpg"), new Uint8Array([1, 2]))
    const source = createFileSystemSource({ root })

    expect(await source.read("uploads/a.jpg", { signal })).toEqual(new Uint8Array([1, 2]))
    expect(await source.read("uploads/missing.jpg", { signal })).toBeUndefined()
    expect(await source.read("uploads/a.jpg/nested", { signal })).toBeUndefined()
  })

  test("rejects files above the size limit as unsupported", async () => {
    await writeFile(join(root, "big.jpg"), new Uint8Array(10))

    const failure = await createFileSystemSource({ root, maxBytes: 5 })
      .read("big.jpg", { signal })
      .catch((error: unknown) => error)

    expect((failure as RenditionError).reason).toBe("unsupported-source")
  })

  test("rejects keys escaping the root", async () => {
    const failure = await createFileSystemSource({ root })
      .read("../outside.jpg", { signal })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(RenditionError)
  })
})

describe("results", () => {
  test("publishes a file under its key without leftovers and serves it from the public URL", async () => {
    const results = createFileSystemResults({ root, publicUrl: "/renditions/" })
    const key = "derived/uploads/фото.jpg/abc.avif"

    expect(await results.exists(key, { signal })).toBe(false)
    await results.write(key, { data: new Uint8Array([7]), contentType: "image/avif" }, { signal })

    expect(await results.exists(key, { signal })).toBe(true)
    expect(await readdir(join(root, "derived/uploads/фото.jpg"))).toEqual(["abc.avif"])
    expect(results.url(key)).toBe(
      `/renditions/derived/uploads/${encodeURIComponent("фото.jpg")}/abc.avif`,
    )
  })
})
