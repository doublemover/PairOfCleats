# Semantic evidence indexing

Semantic indexing is opt-in and uses artifact surface `0.1.0`, SQLite schema `15`
and semantic schemas `1`. Older, newer, missing or mixed format markers are rejected
with `ERR_INDEX_FORMAT_UNSUPPORTED`. Rebuild from source with:

```sh
pairofcleats index build --repo "<repoRoot>" --mode all
```

This writes a new generation; it does not migrate reduced older records or delete
source files. Semantic indexing being disabled does not bypass the format gate.

Enable the rich profile in the existing repository configuration:

```json
{"indexing":{"semantic":{"enabled":true,"profile":"rich"}}}
```

Source-owned JavaScript/TypeScript structure retains ordered arguments, constructors,
object/array structure and UTF-16 source spans. The grouped TypeScript compiler
supplies separately scoped binding evidence without requiring legacy type inference
to be enabled. Aliases, repeated call occurrences and external declarations remain
separate records. The first value slice covers immutable definitions and selected
checker-matched typed-array and message-dispatch models. A dispatch request is not
proof of delivery, detachment, execution thread or actual runtime values.

## Detail and traces

Requests must name the exact repository and generation, plus a semantic RecordRef.
The generation and partition inventories are in `semantic_manifest.json` under the
published mode index. Whole-generation publication uses `semanticRevision: 0`.
Record references are `{ "partitionId": "sy1:<hash>", "localId": 0 }`; use a real
published reference rather than the illustrative placeholder below.

Save a detail request as JSON:

```json
{
  "repoRoot": "<repoRoot>",
  "generation": {"baseBuildId":"<buildId>","semanticRevision":0},
  "refs": [{"partitionId":"sy1:<hash>","localId":0}],
  "include": ["operands","names","ownership"]
}
```

```sh
pairofcleats semantic detail --request detail.json --all
```

Trace requests replace `refs` with `seed` and add `direction` (`upstream` or
`downstream`). Optional `slot` selects an input argument or other named operand;
optional `kinds` restricts semantic edges. Default value traversal does not treat a
call dependency as value flow.

```json
{
  "repoRoot":"<repoRoot>",
  "generation":{"baseBuildId":"<buildId>","semanticRevision":0},
  "seed":{"partitionId":"sy1:<hash>","localId":0},
  "direction":"downstream",
  "limits":{"records":128,"edges":512,"depth":4,"bytes":65536,"workMs":250}
}
```

```sh
pairofcleats semantic trace --request trace.json --all
```

The equivalent MCP operations are `semantic_detail` and `semantic_trace`; HTTP POST
routes are `/analysis/semantic-detail` and `/analysis/semantic-trace`. CLI `--all`
streams bounded JSONL pages in one process. Cursors are opaque, request- and
generation-bound, and expire with their bounded service cache. Expired cursors
return `ERR_SEMANTIC_CURSOR_EXPIRED`; restart with the same retained generation.
Extraction, analysis and response coverage are separate. Query coverage carries
partition provenance and retains incomplete evidence rather than claiming no path.

## Deferred bindings

Set `enrichment.bindings` to `deferred` and `execution.deferredDrain` to `manual`
to retain a durable pending descriptor. `after-index` permits bounded work through
the existing relations scheduler, with `execution.afterIndexMaxMs` as a cooperative
allowance. Synchronous compiler calls cannot be forcibly interrupted by this timer.
The `targeted` profile defers bindings and local flow unless explicitly overridden.

Task state and leases live in a separate semantic frontier SQLite control database.
Missing control-store capability leaves work deferred. Completion is acknowledged
only after normal whole-generation promotion. Changing generations produces a new
target request; old tasks are never retargeted by filename. A general manual drain
CLI, independent overlay publication, complete CFG/SSA and broad LSP enrichment are
not yet available.

## Saved runtime evidence

Import existing evidence explicitly; importing never runs a workload or attaches a
collector:

```sh
pairofcleats ingest runtime-evidence --specification import.json --out evidence-dir
```

The specification contains strict `capture`, `authority`, `inputs`, `sourceCandidates`
and `importOptions` contracts. See the authoritative runtime-evidence schemas and
`tests/helpers/runtime-import-fixture.js` for a complete saved-fixture example.
Inputs resolve relative to the specification file. `importOptions.maxDiskWorkingSetBytes`
bounds storage; the capture's `diskReserveBytes` separately preserves free disk.

Supported adapters are saved Inspector CPU profiles and versioned
`pairofcleats-code-log` interchange records. The latter is not a general parser for
arbitrary V8 diagnostic text. Missing source hashes, unsupported fields and ambiguous
joins stay explicit. Raw artifacts are content-addressed and normalized projections
publish as a standalone immutable family. These are not source-index overlays, and
runtime lookup is not yet exposed through semantic trace.
