# h3 and Other Frameworks

## h3

The handler from [Getting Started](./getting-started#quick-start) is a regular h3 event handler.
Mount it at `<basePath>/**`, `/_renditions/**` by default:

```ts
// server.ts
import { H3, serve } from "h3"

import renditions from "./renditions"

serve(new H3().all("/_renditions/**", renditions))
```

With h3 v1, add it to a router: `createRouter().use("/_renditions/**", renditions)`.

## Other frameworks

For other frameworks, use `createRenditionHandler()` from `image-renditions/server`.
It takes the same options without `getContext` and returns a function from the request and a function returning the context to a `Response`, for example in a fetch handler:

```ts
// server.ts
import { createRenditionHandler } from "image-renditions/server"

const renditions = createRenditionHandler({ server })

export default {
  fetch(request: Request) {
    const { pathname, search } = new URL(request.url)
    // The second argument returns the context resolveSource receives, such as the current tenant.
    return renditions({ method: request.method, path: pathname + search }, () => undefined)
  },
}
```

Build URLs in the app with the [catalog](./showing-images#without-nuxt).
