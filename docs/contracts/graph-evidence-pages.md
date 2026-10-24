# Retained graph evidence pages

This experimental source surface remains unqualified. It exposes the existing
retained-family page owner through `pairofcleats graph-evidence --request file.json
[--all]`, `POST /analysis/graph-evidence`, and MCP `graph_evidence` (schema1.8.0).
It changes no existing graph-context, format or authority contract. Canonical
request/result schemas live in `src/contracts/schemas/graph-evidence.js`.

Requests require schemaVersion1, repoRoot, immutable buildId and family
`call_sites` or `graph_relation_edges`. Optional filters are exact identities:
file/callerChunkUid/targetChunkUid/chunkUid/resolution for occurrences, and
graph/from/to/node for resolved edges. Direction out/in requires chunkUid/node;
both is the default. Limits bound rows (1–512), scanRows (1–4096) and total
response bytes (8192–4194304). Defaults are128/1024/1048576. Requests cannot select
an arbitrary index path, change current pointers, enable semantic extraction or
substitute a newer build. Existing canonical repo-cache admission protects reads.

Each result contains exact generation, ordering, cursor scope, rows, scanned
count and row bytes. Empty filtered pages can have a continuation. CLI --all
streams every page with backpressure, including empty pages. Request files are
bounded to64KiB, read as verified regular files and decoded with fatal UTF8.
HTTP and MCP retain their existing authorized-repository and cancellation owners;
HTTP adapters remain lazy so this reader does not enter health/startup work.

`coverage.scope=retained-family` and `coverage.upstream=not-asserted` are explicit.
Completion means this retained enumeration is exhausted. It does not prove
compiler extraction, ambiguity resolution, omitted propagation or whole-program
completeness. Missing or unsupported positioned storage produces unavailable,
never a fabricated empty family. Original integrity failures remain failures.
Stale build/cursor/filter identity is rejected. Existing source refs expose only
already retained qualified source; no current-worktree source is substituted.

Source regressions cover actual retained files, complete cursor chains and
request/authority negatives. Their execution, full transports, native TUI catalog
disposition, generated command inventory refresh, final import budgets and
resource/performance qualification remain deferred. No passing check is implied.
