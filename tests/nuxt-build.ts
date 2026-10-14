// Builds the Nuxt fixture against the built package, starts its server and checks a page and its renditions over HTTP.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import sharp from "sharp"

import catalog from "./fixtures/nuxt/shared/renditions"

const root = resolve(import.meta.dir, "..")
const fixture = join(root, "tests/fixtures/nuxt")

// Linking the repository into the fixture's `node_modules` installs the package there,
// so the fixture resolves `image-renditions` by name through its `exports`, from the built `dist`.
const link = join(fixture, "node_modules/image-renditions")
await mkdir(dirname(link), { recursive: true })
await rm(link, { force: true })
await symlink(root, link)

const build = spawnSync(process.execPath, ["run", "nuxt", "build", fixture], { stdio: "inherit" })
assert.equal(build.status, 0, "nuxt build failed")

const storage = await mkdtemp(join(tmpdir(), "image-renditions-nuxt-"))
await mkdir(join(storage, "uploads"))
await sharp({ create: { width: 100, height: 80, channels: 3, background: "#f00" } })
  .png()
  .toFile(join(storage, "uploads/photo.png"))

const port = await findFreePort()
const origin = `http://127.0.0.1:${port}`
const server = spawn("node", [join(fixture, ".output/server/index.mjs")], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), RENDITIONS_TEST_STORAGE: storage },
  stdio: ["ignore", "pipe", "pipe"],
})
let output = ""
server.stdout.on("data", chunk => (output += chunk))
server.stderr.on("data", chunk => (output += chunk))

try {
  await waitForServer()
  const photo = { path: "photo.png" }

  // The page renders `<RenditionImg>` and a `useRenditions()` URL from the catalog.
  const html = await (await fetch(origin)).text()
  assert(html.includes(`src="${catalog.url("avatar", photo)}"`), html)
  assert(html.includes(`srcset="${catalog.srcset("avatar", photo)}"`), html)
  assert(html.includes(`href="${catalog.url("avatar", photo, 2)}"`), html)
  // The `originalUrl` module builds the URL of a source the preset shows as it is, with the runtime config of the app.
  assert(html.includes('src="/originals/brand/logo%20%231.svg"'), html)

  // The module mounts the handler at the catalog base path, and the handler renders and stores the rendition.
  const { hash } = catalog.variant("avatar")
  const rendition = await fetch(origin + catalog.url("avatar", photo), { redirect: "manual" })
  assert.equal(rendition.status, 307, output)
  assert.equal(rendition.headers.get("location"), `/stored/photo.png/${hash}.avif`)
  const stored = await sharp(join(storage, "renditions/photo.png", `${hash}.avif`)).metadata()
  assert.deepEqual([stored.width, stored.height], [48, 48])

  const missing = await fetch(origin + catalog.url("avatar", { path: "missing.png" }), {
    redirect: "manual",
  })
  assert.equal(missing.status, 404, output)
  assert.equal(await missing.text(), "source-not-found")
} finally {
  server.kill()
  await rm(storage, { recursive: true, force: true })
}
console.log("The Nuxt fixture works.")

async function findFreePort() {
  const probe = createServer()
  await new Promise<void>(done => probe.listen(0, "127.0.0.1", done))
  const { port } = probe.address() as { port: number }
  await new Promise(done => probe.close(done))
  return port
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100 && server.exitCode === null; attempt++) {
    if (
      await fetch(origin).then(
        response => response.ok,
        () => false,
      )
    ) {
      return
    }
    await delay(100)
  }
  assert.fail(`The Nuxt server did not start:\n${output}`)
}
