# image-renditions Agent Guide

## Overview

On-demand image transformations that persist every result to durable storage and keep app servers stateless.

Read [README.md](README.md) completely before changing the public API, package behavior, supported runtimes, or user documentation.

Extend this guide only with stable, non-obvious conventions, architecture, contracts, workflows, and gotchas.
Do not catalog files or restate information evident from their names and locations.

## Scope

- Keep production code in `src/`.
- Keep focused module tests beside their source as `*.test.ts`.
- Keep integration, package-boundary, and type-inference tests in `tests/`.
- Name compile-only tests `*.type-test.ts`.
- Keep `index.ts` files limited to explicit public re-exports.
- Keep a module of one file as a file, and turn a module of several files into a directory with an `index.ts`.
- Treat `package.json` exports and supported runtimes as public contracts.

## Architecture

- Keep the root entry browser-safe: it may import only `@noble/hashes`; `tests/entry-imports.test.ts` enforces it.
- Import `h3` only in `src/h3.ts`, `sharp` only in `src/processors/sharp/`, `@aws-sdk/client-s3` only in `src/stores/s3.ts`, and `nuxt`, `vue` and `jiti` only in `src/nuxt/`; these packages are optional peers or Nuxt-only dependencies.
- Keep `jiti` a regular dependency: the Nuxt module must resolve it from this package under isolated installs.
- Keep `src/server/` independent of storage, processor and framework; it owns the store and processor contracts.
- Keep `src/redis/` free of Redis client libraries: it reaches Redis only through the `sendCommand` function the application passes.
- Put each store implementation in `src/stores/` and each processor in `src/processors/`, and ship each as its own entry; `tests/entry-imports.test.ts` checks that the server imports no such library.
- Put an integration that implements several contracts, such as `src/redis/`, at the top level of `src/` rather than in a folder of one contract, and ship it as one entry.
- Keep the h3 adapter working with h3 v1 and v2: `tests/h3.test.ts` runs it on both, and `tests/h3-v1/` typechecks it against h3 v1.
- Any change to recipe normalization or serialization changes hashes and regenerates every stored rendition; make it only deliberately.
- Bump `RECIPE_ENGINE_VERSION` when processing of an unchanged recipe changes its output.
- Key readiness indexes and coordination by the public URL of the rendition, which stays unique across stores.

## Documentation

- Write public README and JSDoc text for package users who do not know the implementation.
- Add JSDoc to every exported declaration and to internal helpers whose contract, inputs, output, or failure behavior is not obvious.
- Add inline comments beside every non-obvious invariant, algorithmic choice, safety constraint, and intentionally limited behavior.
- Update nearby JSDoc and inline comments whenever the documented code changes, and remove comments that no longer apply.
- Do not narrate self-evident syntax or restate what a name already communicates.
- Do not document obvious or implied defaults.
- Describe a default only when readers need it to make a decision or avoid surprising behavior.
- Use One Sentence Per Line for connected prose.
- Keep semantically connected explanations as prose paragraphs.
- Use lists for separate assertions instead of presenting them as prose paragraphs.

## Changesets

- Before the first publication, update `.changeset/initial-release.md` instead of creating additional changesets.
- After the first publication, add one `.changeset/*.md` file for each independently releasable user-visible change.
- Do not add changesets for internal refactors, maintenance, tests, or documentation changes that do not require a package release.
- Choose the SemVer bump from the public contract: `patch` for backward-compatible fixes and `minor` for backward-compatible functionality.
- Before 1.0, use `minor` for breaking changes; starting with 1.0, use `major` and remove this rule.
- Create `.changeset/<unique-name>.md` with this format:

```markdown
---
"image-renditions": patch
---

Describe the user-visible change.
```

- Briefly describe the user-observable change or new capability in the public contract, without implementation details or rationale.
  Prefer a single sentence.
- Do not edit the package version or `CHANGELOG.md` by hand, and do not run `changeset version` or `changeset publish`; the release workflow consumes pending changesets.

## Tests

- Add a `describe` block where the file gives a reason for it: several APIs or behaviors in one file, or a fixture that belongs to some cases but not all.
  Name such a block after what it covers and keep its fixtures inside it.
- Distinguish several same-kind values by role rather than by order.
  When values differ only by order, number them with digits instead of ordinal words.
- Keep tests deterministic so a failure repeats on every run.
  Generate random inputs from an explicit seed and print the seed in failure messages so the failing input can be replayed.

## Checks

- Run the `types` script when public types or TypeScript configuration change.
- Run the `test` script when behavior changes.
  It needs `redis-server` on `PATH`; the Redis tests start their own instance.
- Run the `build` script when package exports, declarations, or supported runtimes change.
- Run the `test:nuxt` script when the Nuxt module, its runtime, or the package entries it imports change; it builds the package and a Nuxt fixture app.
