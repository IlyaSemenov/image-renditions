import {
  defineCatalog,
  type PresetName,
  type RenditionTarget,
  type ScopeName,
} from "image-renditions"
import { defineRenditionEventHandler } from "image-renditions/h3"
import {
  createRenditionHandler,
  createRenditionServer,
  type RenditionServerOptions,
  type SourceResolver,
} from "image-renditions/server"

interface Context {
  tenant: string
}

const scoped = defineCatalog({ scopes: ["tenant", "global"], presets: { avatar: { width: 48 } } })
const unscoped = defineCatalog({ presets: { avatar: { width: 48 } } })

declare const stores: Pick<RenditionServerOptions<Context>, "source" | "results" | "processor">

// The names of a catalog are unions of its presets and declared scopes.
export const names: [PresetName<typeof scoped>, ScopeName<typeof scoped>] = ["avatar", "global"]
// @ts-expect-error The scope is not declared.
export const undeclaredName: ScopeName<typeof scoped> = "other"
export const unscopedName: ScopeName<typeof unscoped> = "any"

// @ts-expect-error Scopes of a catalog type are declared in the catalog too.
export const undeclaredScopes = defineCatalog<"avatar", "tenant">({
  presets: { avatar: { width: 48 } },
})

// A catalog with scopes requires one of them in every target, and a catalog without them takes any or none.
export const urls = [
  scoped.url("avatar", { scope: "tenant", path: "a.jpg" }),
  unscoped.url("avatar", { path: "a.jpg" }),
  unscoped.url("avatar", { scope: "any", path: "a.jpg" }),
]

// The catalog of the server types the targets its resolver receives.
export const server = createRenditionServer({
  catalog: scoped,
  ...stores,
  resolveSource({ scope, path }, { tenant }: Context) {
    const declared: "tenant" | "global" = scope
    return { sourceKey: declared === "tenant" ? `${tenant}/${path}` : path }
  },
})
export const handler = defineRenditionEventHandler({
  server,
  getContext: () => ({ tenant: "acme" }),
})

// A resolver defined apart from the server gets its parameter and result types from `SourceResolver`.
const separateResolver: SourceResolver<Context, ScopeName<typeof scoped>> = (
  { scope, path },
  { tenant },
) => {
  const declared: "tenant" | "global" = scope
  return { sourceKey: declared === "tenant" ? `${tenant}/${path}` : path }
}
export const separateServer = createRenditionServer({
  catalog: scoped,
  ...stores,
  resolveSource: separateResolver,
})

export const tenantResolver = createRenditionServer({
  catalog: scoped,
  ...stores,
  // @ts-expect-error A resolver of fewer scopes than the catalog declares cannot serve every target.
  resolveSource: ({ path }: RenditionTarget<"tenant">, { tenant }: Context) => ({
    sourceKey: `${tenant}/${path}`,
  }),
})

export const undeclaredTarget = server.ensure(
  scoped.variant("avatar").recipe,
  // @ts-expect-error The scope is not declared.
  { scope: "other", path: "a.jpg" },
  { tenant: "acme" },
)

// The target of a failure is one the server resolves.
export const fallbackHandler = createRenditionHandler({
  server,
  async onFailure({ target, context }) {
    if (target) {
      await server.resolve(target, context)
    }
    return undefined
  },
})
