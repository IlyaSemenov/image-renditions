import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

const transpiler = new Bun.Transpiler({ loader: "ts" })

/** Collects bare imports reachable from a source module through its relative imports. */
function collectPackageImports(entry: string) {
  const visited = new Set<string>()
  const packages = new Set<string>()
  const pending = [resolve(import.meta.dir, entry)]
  for (let file = pending.pop(); file; file = pending.pop()) {
    if (visited.has(file)) {
      continue
    }
    visited.add(file)
    for (const { path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      if (path.startsWith(".")) {
        pending.push(resolve(dirname(file), `${path}.ts`))
      } else {
        packages.add(path)
      }
    }
  }
  return [...packages]
}

test("the root entry imports nothing but browser-safe hashing", () => {
  expect(collectPackageImports("../src/index.ts").toSorted()).toEqual([
    "@noble/hashes/sha2.js",
    "@noble/hashes/utils.js",
  ])
})

test("the server imports no storage or image library", () => {
  expect(collectPackageImports("../src/server/index.ts").toSorted()).toEqual([
    "@noble/hashes/sha2.js",
    "@noble/hashes/utils.js",
  ])
})

test("the Redis entry imports no Redis client", () => {
  expect(collectPackageImports("../src/redis/index.ts")).toEqual([])
})

test("the Nuxt runtime imports no server code", () => {
  expect(collectPackageImports("../src/nuxt/runtime.ts").toSorted()).toEqual(["nuxt/app", "vue"])
})
