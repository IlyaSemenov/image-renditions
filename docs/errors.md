# Errors

The handler responds to a failure with the status of its reason:

- `invalid-request` (404): malformed URL, `resolveSource` rejected the target, or a key is unsafe or too long for the store
- `unknown-recipe` (404): hash neither in the catalog nor known as published
- `source-not-found` (404): no source under the resolved key
- `unsupported-source` (422): source cannot be decoded or processed
- `source-too-large` (422): source exceeds a byte or pixel limit
- `source-error` (502): reading the source failed
- `processing-failed` (500): processing failed for a reason other than the source
- `storage-error` (502): checking for or writing the rendition failed
- `overloaded` (503): processing queue is full or the wait timed out

## Outdated URLs

A page rendered before a preset changed keeps requesting the old hash, which the catalog no longer has.
The handler serves it while the process or a shared readiness index remembers its rendition.
Otherwise the request fails as `unknown-recipe` without calling the stores, so made-up hashes cause no storage traffic either.

## Custom responses

`onFailure` can report a failure or replace the response, for example with the original image:

```ts
export default defineRenditionEventHandler({
  server,
  getContext,
  async onFailure({ reason, error, source }) {
    if (reason === "storage-error" || reason === "processing-failed") {
      reportError(error)
    }
    if (reason === "unknown-recipe" && source) {
      // Here sources are public, so an outdated URL shows the original instead.
      return Response.redirect(`https://uploads.example.com/${encodePath(source.sourceKey)}`, 302)
    }
    return undefined
  },
})
```

- `target` is the target of the URL, absent when the URL is malformed or its scope is not declared.
- `source` holds the keys of the target, absent when the request failed before the server resolved them and checked that they are safe; the source need not exist.
- `server.resolve()` returns the keys of any target, as `resolveSource` gives them after checking that they are safe.

Returning `undefined` keeps the default response.
Every failure response, including a replaced one, is sent with `Cache-Control: no-store`.
