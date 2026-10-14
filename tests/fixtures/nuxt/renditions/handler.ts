import { join } from "node:path"

import { createFileSystemResults, createFileSystemSource } from "image-renditions/fs"
import { defineRenditionEventHandler } from "image-renditions/h3"
import { createRenditionServer } from "image-renditions/server"
import { createSharpProcessor } from "image-renditions/sharp"

import catalog from "#shared/renditions"

// The test passes a directory with sources in `uploads/` and receives renditions in `renditions/`.
const storage = process.env.RENDITIONS_TEST_STORAGE!

export default defineRenditionEventHandler({
  server: createRenditionServer({
    catalog,
    source: createFileSystemSource({ root: join(storage, "uploads") }),
    results: createFileSystemResults({ root: join(storage, "renditions"), publicUrl: "/stored" }),
    processor: createSharpProcessor(),
  }),
})
