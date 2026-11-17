# image-renditions Agent Guide

## Overview

On-demand image transformations that persist every result to durable storage and keep app servers stateless.

Before changing the public API, package behavior, supported runtimes, or user documentation, read the pages of the user documentation in [docs/](docs/) that the change affects.

Read the relevant guide in [development/](development/README.md) before starting:

- [user-documentation.md](development/user-documentation.md) before changing user documentation.

Extend this guide only with stable, non-obvious conventions, architecture, contracts, workflows, and gotchas that most changes need; put those of one topic in a guide in development/, and list the guide in its index and above with the task that needs it.
Do not catalog files or restate information evident from their names and locations.

## Scope

- Keep production code in `src/`.
- Name a directory of one concept in the singular, such as `parser/`, and a directory of like items in the plural, such as `rules/`.
- Keep a module of one file as a file, and turn a module of several files into a directory with an `index.ts`.
- Keep focused module tests beside their source: `foo.test.ts` and `foo.type-test.ts` test `foo.ts`.
- Test each behavior at the lowest level that can check it: a helper directly, a module that combines helpers by its own unit tests.
- Keep a test of how several modules work together beside the module that combines them, or beside the modules it covers until such a module exists.
- Keep a test helper that builds or reads internals beside them in `src/<module>/testing.ts`, so that nothing outside `src/` imports from `src/`.
- Keep integration and package-boundary tests in `tests/`, importing the package by name: they see only the public API.
- Name runtime tests `*.test.ts` and compile-only type tests `*.type-test.ts`.
- Keep `index.ts` files limited to explicit public re-exports.
- Export from each entry every type that the inferred types of its public values reference, so that the declarations of a consumer module can name them.
- Treat `package.json` exports and supported runtimes as public contracts.

## Architecture

- Keep the root entry browser-safe: it may import only `@noble/hashes`; `tests/entry-imports.test.ts` enforces it.
- Import `h3` only in `src/h3.ts`, `sharp` only in `src/processors/sharp/`, `@aws-sdk/client-s3` only in `src/stores/s3.ts`, and `nuxt`, `vue` and `jiti` only in `src/nuxt/`; these packages are optional peers or Nuxt-only dependencies.
- Keep `jiti` a regular dependency: the Nuxt module must resolve it from this package under isolated installs.
- Keep `src/server/` independent of storage, processor and framework; it owns the store and processor contracts.
- Keep `src/redis/` free of Redis client libraries: it reaches Redis only through the `sendCommand` function the application passes.
- Keep the Redis ACL commands listed in `docs/replicas.md` in sync with the commands `src/redis/` sends, including those its Lua scripts call.
- Put each store implementation in `src/stores/` and each processor in `src/processors/`, and ship each as its own entry; `tests/entry-imports.test.ts` checks that the server imports no such library.
- Put an integration that implements several contracts, such as `src/redis/`, at the top level of `src/` rather than in a folder of one contract, and ship it as one entry.
- Keep the h3 adapter working with h3 v1 and v2: `tests/h3.test.ts` runs it on both, and `tests/h3-v1/` typechecks it against h3 v1.
- Any change to recipe normalization or serialization changes hashes and regenerates every stored rendition; make it only deliberately.
- Bump `RECIPE_ENGINE_VERSION` when processing of an unchanged recipe changes its output.
- Key readiness indexes and coordination by the public URL of the rendition, which stays unique across stores.

## Design

- With every change, look for refactorings that reduce the complexity of the code it touches, such as duplicated logic or a concept spread over several modules.
  Make those that ease the change, and propose the others in the final report, listed apart from its fixes.
- Give a domain rule or contract a function of its own at its first use, such as how a cache key is built or which values an option accepts, so that the next use finds it; move such a function to a module of its own when several modules use it.
  Do not extract code that only looks alike.
- Split a module when it holds several distinct concepts that read better apart.
- Before adding a helper, search for an existing one that does the same.

## Refactoring

- When moving or splitting code, move its tests to follow it.

## Documentation

- Update the affected site pages together with a change to the public API or behavior.
- Write public documentation and JSDoc text for package users who do not know the implementation.
- When a change makes an existing statement false, fix that statement rather than add an explanation next to it.
- Add JSDoc to every exported declaration and to internal helpers whose contract, inputs, output, or failure behavior is not obvious.
- Add inline comments beside every non-obvious invariant, algorithmic choice, safety constraint, and intentionally limited behavior.
- Update nearby JSDoc and inline comments whenever the documented code changes, and remove comments that no longer apply.
- Do not narrate self-evident syntax or restate what a name already communicates.
- Describe a default only when readers need it to make a decision or avoid surprising behavior.
- Use One Sentence Per Line for connected prose, including JSDoc and code comments: do not wrap a sentence across lines.
- Keep semantically connected explanations as prose paragraphs, and use lists for separate assertions.
- Link a file of another repository by a tag or a commit, such as of the version you checked, never by a branch such as `main`, whose file changes.

## Changesets

- Add changesets as [.changeset/README.md](.changeset/README.md) describes.

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
  The Redis tests use the Redis at `REDIS_URL` and wipe its database; without `REDIS_URL` they start their own `redis-server`, which must be on `PATH`.
- Run the `build` script when package exports, declarations, or supported runtimes change.
- Run the `test:nuxt` script when the Nuxt module, its runtime, or the package entries it imports change; it builds the package and a Nuxt fixture app.
- Run the `docs:build` script when site pages or the VitePress configuration change.
