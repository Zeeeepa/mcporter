---
summary: "Pending upstream bug: SDK 1.22.0 crashes on tools/list when tools are registered with JSON Schema (not Zod)"
read_when:
  - "Investigating SDK version bumps or mcporter generate-cli failures"
  - "Seeing 'Cannot read properties of undefined (reading "typeName")' from tools/list"
---

# @modelcontextprotocol/sdk 1.22.0 regression (tools/list crashes)

## What happens
`tools/list` throws `Cannot read properties of undefined (reading 'typeName')` when a server registers tools with **JSON Schema** `inputSchema`/`outputSchema` (spec‑compliant). This breaks `mcporter generate-cli --compile` against inline STDIO servers and any server that provides JSON Schema instead of Zod.

## Repro (in this repo)
- File: `tests/cli-generate-cli.integration.test.ts` writes `mock-stdio.mjs` that calls `registerTool('echo', { inputSchema: {type:'object',...}, outputSchema:{...} }, cb)`.
- With `@modelcontextprotocol/sdk@1.22.0`, running `pnpm test` or `mcporter generate-cli "node mock-stdio.mjs" --compile ...` fails with the error above when `tools/list` runs.

## Why (code path in SDK 1.22.0)
- `McpServer.setRequestHandler(ListToolsRequestSchema)` unconditionally passes `tool.inputSchema` / `tool.outputSchema` to `zodToJsonSchema(...)`.
- For JSON objects (no `_def`), `zod-to-json-schema` tries to read `schema._def.typeName` and throws.
- `call_tool` also assumes Zod (`safeParseAsync`) and would fail later for JSON Schema tools.

## Minimal upstream fix (suggested)
- Guard with the existing `isZodTypeLike` helper:
  - If schema is Zod → keep current conversion/validation.
  - Else → treat it as already-JSON-Schema: pass through in `tools/list`; skip Zod validation in `call_tool`.

## Current mitigation here
- Pinned `@modelcontextprotocol/sdk` to `~1.21.2` and kept `zod@3.x` to match.
- Runtime `listTools` now paginates and matches 1.22+ signature; tests green on the pinned SDK.

## Upstream status
- As of 2025-11-22: no public issue found that matches this exact regression. Consider filing against `modelcontextprotocol/typescript-sdk` with the inline repro above.

## Action items when unpinning
1) Check if a newer SDK release adds guards around `zodToJsonSchema` / `safeParseAsync` for JSON Schema.
2) If fixed, drop the pin and re-run `pnpm check && pnpm test`.
3) If not fixed, keep the pin or patch upstream and send a PR.
