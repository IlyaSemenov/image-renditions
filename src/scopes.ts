import type { RenditionTarget } from "./catalog"

/** Checks that a target has a scope the catalog declares, or no scope when the catalog declares none. */
export function isDeclaredScope(scopes: readonly string[] | undefined, scope: string | undefined) {
  return scopes ? scope !== undefined && scopes.includes(scope) : scope === undefined
}

/**
 * Throws a `RangeError` unless a target has a scope the catalog declares, or no scope when the catalog declares none.
 *
 * @throws {RangeError} When the scope is missing, not declared, or given to a catalog without scopes.
 */
export function assertDeclaredScope(
  scopes: readonly string[] | undefined,
  scope: string | undefined,
) {
  if (!isDeclaredScope(scopes, scope)) {
    throw new RangeError(
      scope === undefined
        ? "Missing rendition scope."
        : scopes
          ? `Undeclared rendition scope "${scope}".`
          : `Rendition scope "${scope}" in a catalog without scopes.`,
    )
  }
}

/** Target of a scope and a path, typed by the scopes of the catalog, or `undefined` when the catalog does not declare the scope. */
export function toDeclaredTarget<Scope extends string>(
  scopes: readonly Scope[] | undefined,
  scope: string | undefined,
  path: string,
): RenditionTarget<Scope> | undefined {
  // TypeScript cannot narrow a scope to the conditional target type, so the declared scope check stands in for it.
  return isDeclaredScope(scopes, scope)
    ? ({ scope, path } as unknown as RenditionTarget<Scope>)
    : undefined
}
