import { beforeAll, describe, expect, mock, test } from "bun:test"

import type { H3Event } from "h3"
import { H3 } from "h3"
import * as h3v1 from "h3-v1"
import { defineRenditionEventHandler } from "image-renditions/h3"

import { catalog, createFakes } from "./fakes"

const target = { scope: "tenant", path: "uploads/1/фото.jpg" } as const

function createOptions() {
  const fakes = createFakes()
  fakes.sources.set(`tenant/acme/${target.path}`, new Uint8Array([1]))
  return {
    server: fakes.createServer(),
    getContext: (event: H3Event) => ({ tenant: event.headers.get("host")!.split(".")[0]! }),
  }
}

/** Requests a rendition from the `acme` tenant host. */
function request(url: string) {
  return new Request(`http://acme.test${url}`, { headers: { host: "acme.test" } })
}

const expectedLocation = `https://cdn.test/${encodeURI(`tenant/acme/derived/${target.path}`)}/${catalog.variant("avatar").hash}.avif`

describe("h3 v2", () => {
  test("serves a rendition with the context derived from the event", async () => {
    const app = new H3().all("/_renditions/**", defineRenditionEventHandler(createOptions()))

    const response = await app.fetch(request(catalog.url("avatar", target)))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(expectedLocation)
  })
})

describe("h3 v1", () => {
  beforeAll(() => {
    // The adapter imports `defineEventHandler` from the consumer's h3, so swapping the module exercises v1.
    mock.module("h3", () => h3v1)
  })

  test("serves a rendition with the context derived from the event", async () => {
    // The adapter is typed against the h3 v2 installed for development.
    const handler = defineRenditionEventHandler(createOptions()) as unknown as h3v1.EventHandler
    const router = h3v1.createRouter().use("/_renditions/**", handler)
    const app = h3v1.createApp().use(router)

    const response = await h3v1.toWebHandler(app)(request(catalog.url("avatar", target)))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(expectedLocation)
  })
})
