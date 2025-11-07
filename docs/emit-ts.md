# `mcporter emit-ts` Plan

## Why

Our "agents call TypeScript via our proxy" mode and external integrators both need a
stable, IDE-friendly description of each MCP server. Today they either scrape
`mcporter list` output or parse JSON schema on the fly, which is brittle and
impossible to type-check. An `emit-ts` command gives us a single, reproducible
artifact (Think `.ts`/`.d.ts`) that mirrors the pseudo-TypeScript we already
print, so:

- Agents get autocompletion + type safety when composing calls.
- We can run `tsc` against agent-generated snippets before invoking remote tools.
- The exported contract doubles as documentation and feeds future generators.

## CLI Surface

```
mcporter emit-ts <server> --out linear-client.ts [--mode types|client] [--include-optional]
```

- Default `--mode types`: emits TypeScript declarations only.
- `--mode client`: emits executable wrappers that internally use `createServerProxy` and return `CallResult` objects.
- `--include-optional`: mirror `mcporter list --all-parameters` to include every
  parameter in the signature.
- Outputs overwrite existing files automatically (no `--force` needed).

## Output Modes

### 1. Types (default)

- File layout:
  - Header comment with generator metadata + source definition.
  - `export interface <ServerName>Tools { ... }` – each method matches
    `ToolDocModel.tsSignature` minus the leading `function` keyword.
  - Optional type aliases for inferred return types (when schemas expose titles);
    otherwise return type defaults to `CallResult` (wrapping the raw response).
  - Doc comments pulled verbatim from `doc.docLines`.
  - Inline hints (optional summary / flag usage) emitted as `//` comments.
- Emits a `.d.ts` file by default. When `--mode client` targets `foo.ts`, the
  interface file becomes `foo.d.ts` unless `--types-out` overrides it.

### 2. Client wrappers (`--mode client`)

- Emits the interface (inline or via the `.d.ts`) plus a factory that returns an
  object whose methods forward to `createServerProxy`. The object’s lifetime is
  the caller’s responsibility; they pass an existing runtime or the factory
  creates/closes one if omitted.
- Example stub:
  ```ts
  import { createRuntime, createServerProxy, createCallResult } from 'mcporter';
  import type { LinearTools } from './linear-client.d.ts';

  export async function createLinearClient(options?: CreateRuntimeOptions) {
    const runtime = options?.runtime ?? (await createRuntime(options));
    const proxy = createServerProxy(runtime, 'linear');
    return {
      async list_comments(params: Parameters<LinearTools['list_comments']>[0]) {
        const raw = await proxy.list_comments(params);
        return createCallResult(raw);
      },
      // …
    } satisfies LinearTools;
  }
  ```
- Because return schemas are often missing, wrappers always resolve to
  `CallResult`, giving callers a consistent API regardless of server metadata.

## Implementation Steps

1. **Command wiring**
   - Add `emit-ts` subcommand (preferred over `--emit-ts` flag) with
     options: `--server`, `--out`, `--mode`, `--include-optional`, `--types-out`.
   - Default `--mode types`, derive `.d.ts` path from `--out` when needed.

2. **Doc model reuse**
   - Fetch tools with `includeSchema: true`, map through `buildToolDoc`
     (respecting `requiredOnly` vs `--include-optional`).
   - Collect metadata (server name, source path, transport) for header comments.

3. **Templates**
   - Types template consumes `ToolDocModel` array to emit doc comments + method
     signatures (no runtime imports). Unknown schemas → `CallResult` return type.
   - Client template imports the interface (from `.d.ts`), emits factory + helper
     wrappers that call `createServerProxy` and wrap results with `createCallResult`.

4. **Filesystem**
   - Write outputs atomically (tmp file + rename) and overwrite existing files.
   - When `--mode client`, emit both `--out` (client) and derived `.d.ts` unless
     the user supplies `--types-out`.
   - Optionally record generator metadata (similar to CLI artifacts) for future
     inspection.

5. **Testing**
   - Add `tests/emit-ts.test.ts` that runs the command against the integration
     server. Assertions:
       * Types mode: snapshot `.d.ts`, run `tsc --noEmit` to ensure validity.
       * Client mode: snapshot `.ts`, run `ts-node` with a mocked runtime to
         ensure wrappers call the proxy correctly and return `CallResult`.

6. **Docs**
   - Point `docs/call-syntax.md` (and README) to `docs/emit-ts.md` for usage.
   - Include before/after snippets demonstrating both modes and how agents
     consume the outputs.

## Open Questions

- Should client wrappers auto-close runtimes they create? (Default: caller
  controls lifetime; we may add `withClient` helper later.)
- Do we support emitting only a subset of tools? (Future enhancement.)
