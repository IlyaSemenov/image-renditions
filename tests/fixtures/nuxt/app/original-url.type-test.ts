// Compile-only: the module registers the catalog, so the targets of `defineRenditionOriginalUrl()` have its scopes.
import type useOriginalUrl from "./original-url"

type Scope = Parameters<ReturnType<typeof useOriginalUrl>>[0]["scope"]

export const declared: Scope = "tenant"
// @ts-expect-error The catalog does not declare the scope.
export const undeclared: Scope = "other"
