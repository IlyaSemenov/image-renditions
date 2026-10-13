import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"

import { encodePath, isSafePath } from "../path"
import { RenditionError } from "../server/error"
import type { ResultStore, SourceStore } from "../server/stores"

/** Options of {@link createFileSystemSource}. */
export interface FileSystemSourceOptions {
  /** Directory source keys are resolved in. */
  root: string
  /** Largest source file, in bytes; larger sources are unsupported. */
  maxBytes?: number
}

/** Options of {@link createFileSystemResults}. */
export interface FileSystemResultsOptions {
  /** Directory renditions are written to. */
  root: string
  /**
   * URL the directory is served at, such as `https://cdn.example.com/renditions` or `/renditions`.
   *
   * The web server in front of it sets `Cache-Control`; renditions never change, so it can mark them immutable.
   */
  publicUrl: string
}

/** Creates a source store reading files from a directory. */
export function createFileSystemSource({
  root,
  maxBytes = 50 * 1024 * 1024,
}: FileSystemSourceOptions): SourceStore {
  return {
    async read(key, { signal }) {
      const path = resolvePath(root, key)
      const stats = await stat(path).catch(ignoreMissing)
      if (!stats?.isFile()) {
        return undefined
      }
      if (stats.size > maxBytes) {
        throw new RenditionError(
          "unsupported-source",
          `The source ${key} exceeds ${maxBytes} bytes.`,
        )
      }
      return new Uint8Array(await readFile(path, { signal }))
    },
  }
}

/** Creates a result store writing files to a directory that a web server serves. */
export function createFileSystemResults({
  root,
  publicUrl,
}: FileSystemResultsOptions): ResultStore {
  return {
    async exists(key) {
      const stats = await stat(resolvePath(root, key)).catch(ignoreMissing)
      return stats?.isFile() ?? false
    },
    async write(key, { data }, { signal }) {
      const path = resolvePath(root, key)
      await mkdir(dirname(path), { recursive: true })
      // Renaming within a directory is atomic, so the web server never serves a partial file.
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, data, { signal })
        await rename(temporary, path)
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
    },
    url: key => `${publicUrl.replace(/\/$/, "")}/${encodePath(key)}`,
  }
}

function resolvePath(root: string, key: string) {
  const base = resolve(root)
  const path = resolve(base, key)
  // A filesystem root such as `/` already ends with a separator.
  const prefix = base.endsWith(sep) ? base : base + sep
  if (!isSafePath(key) || !path.startsWith(prefix)) {
    throw new RenditionError("invalid-request", `Unsafe storage key ${key}.`)
  }
  return path
}

function ignoreMissing(error: NodeJS.ErrnoException) {
  if (error.code === "ENOENT" || error.code === "ENOTDIR") {
    return undefined
  }
  throw error
}
