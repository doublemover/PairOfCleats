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
separate records. Local control flow retains mutable reaching definitions, merge
values, branches, loops and exceptional routes. Resolved calls retain distinct
return channels; context-insensitive channels and unsupported effects report partial
coverage. Selected checker-matched typed-array and message-dispatch models remain
conservative. A dispatch request is not
proof of delivery, detachment, execution thread or actual runtime values.

Allocation/field candidates retain conditional and mutable receiver aliases, explicit
weak writes, bounded literal-key unions and widened unknown keys. Overlapping paths
share may dependencies. Private property paths use source/class identity and cannot
alias dynamic public keys. This models lexical brands, not runtime brand checks;
alias order, escape and prototype effects remain unknown. Nested object/array
destructuring, defaults and mutable receiver alternatives retain bounded candidate
paths. Nested shorthand/spread initializers resolve the selected field rather than
using the whole spread object; snapshot and overwrite order remain conservative. Local summaries retain bare/implicit undefined returns and respect explicit
finally return/throw overrides; more complex completion alternatives remain conservative.

Call-site summaries join bounded source-backed callable alternatives, retain positional
and rest-argument channels, and keep an unknown result/effect remainder when targets
or summaries are incomplete. Visible object/class methods, inherited members, callable
fields and source prototype replacements contribute modeled dispatch candidates.
Receiver field effects can reach following caller reads. These candidates do not prove
runtime dispatch. Visible constructors, parameter properties and instance field
initializers supply receiver effects; default derived constructors and explicit super
calls retain bounded base candidates. Getter/setter invocations use the shared call
summary contract, and getter return expressions can supply callable candidates.
Constructor object-return overrides, initialization order, proxies, runtime private
brands, lexical arrow receivers, rest-array mutation and escaping aliases remain partial. Limits include 32 alias/target candidates, 16 key candidates and bounded work;
coverage records truncation rather than silently declaring complete analysis.

Checker-authorized Function.call/apply and same-source const bound functions can
reuse source summaries with normalized receiver and argument positions. Literal
apply arrays retain positions; dynamic array-like inputs do not. Bind prefixes and
the first bound receiver survive subsequent binding. TypeScript's type-only `this`
parameter consumes no runtime argument. Unknown method-replacement effects retain
original operands separately, including receivers ignored by native bind semantics.
Callable adaptation is bounded to 16 alias steps, 32 positional arguments and
64 unknown-only inputs; bound construction, cross-source bound captures, runtime
receiver coercion and arbitrary method replacement remain unproved.

With `enrichment.crossFileFlow: "eager"`, the existing compiler group can link a
checker-authorized `new Worker(new URL("./worker.ts", import.meta.url))` to an exact
retained entry source and modeled message consumers. Dynamic entry URLs remain
unresolved. Generic serialization is a packing request; transfer and shared-storage
requests remain separate, and none asserts delivery, detachment or a copied backing
buffer. User-defined APIs with matching names do not receive platform models.

Browser ports can retain source endpoint candidates through worker requests/replies
and port relays. A literal transfer list establishes MessageEvent.ports candidates
in port-relative order; uncertain intervening entries prevent unsupported index
claims. Literal object/array payload paths can retain transferred port identity.
Missing, dynamic, duplicate or oversized transfers do not establish unsupported
identity. Limits are 8 propagation rounds, 32 candidates/list entries, depth 8 and
100,000 join operations. Typed declarations or established source provenance are
required; speculative listener names alone never establish a worker-global endpoint.

Verified Node `worker_threads` declarations use the same retained-source inventory
and boundary writer. Anchored Worker entries join `workerData` uses, direct message
payload callbacks, replies through `parentPort`, and opposite ports of a visible
MessageChannel allocation. Const/destructured and source-backed imported port aliases
are supported. A port present in both a literal payload and its literal transfer list
can retain endpoint identity through workerData or a message callback. Nested literal
paths are bounded to depth 8, 32 endpoint candidates and 8 join rounds; dynamic keys,
missing transfer lists and unresolved payloads do not establish identity. Dynamic or
eval entries, registration order, instance multiplicity and actual delivery remain unknown. Node EventTarget listeners,
BroadcastChannel and provider-specific RPC protocols are not modeled by this pass.

## WASM module evidence

Semantic code discovery admits standalone `.wasm` files alongside JavaScript and
TypeScript. Binary source manifests retain the original SHA-256 bytes with
`encoding: "binary"`, `decoding: "wasm-binary-v1"`, `coordinateUnit: "byte"`, an empty
text hash, `textLength: 0`, and `lineStarts: [0]`. The existing content-addressed
source store keeps its legacy `.utf8` blob suffix; the manifest, not the suffix,
determines encoding. Binary records have null text spans. Instruction byte ranges
and original bytes live in registered evidence; text/LSP consumers skip binaries.
The normal per-file completion and publication owners retain these module-only
files without manufacturing searchable text chunks or a second recovery store.

The checker-authorized host pass accepts bounded literal arrays, checked immutable
const aliases, spreads, `Uint8Array.of`, copying constructors, slice/subarray views,
and analyzable Response/arrayBuffer chains. Module/Instance constructors, awaited
compile/instantiate overloads, and compileStreaming/instantiateStreaming preserve
module provenance. An anchored `new URL("./module.wasm", import.meta.url)` passed to
verified fetch or Node fs reads can join an admitted binary source from the same
retained generation. These are modeled candidates: response MIME, delivery and
runtime filesystem bytes are unobserved. No network request, working-tree module
read, compilation, instantiation or execution occurs during analysis. Mutable or
escaped byte buffers and instantiation-result wrappers do not authorize exact joins.
ArrayBuffer-backed typed-array views retain shared mutation checks; typed-array
copy constructors remain distinct. Escaped or shadowed Instance aliases cannot
establish native exports provenance; escaped instantiation promises also fail the
join, while safe awaited const aliases remain usable. Type-only `this` parameters in imported host
callbacks do not shift WASM runtime argument or rest-parameter positions.

The bounded decoder retains recursive/function/struct/array types, imports/exports,
functions, tables, memories, globals, tags, start entries, active/passive/declarative
segments, custom-section locations and instruction immediates. It supports numeric
core, multi-value, reference/GC, tail-call, bulk-memory, SIMD/relaxed-SIMD, atomic,
shared-memory, memory64/multi-memory, and current/legacy exception instructions.
The runtime's static `WebAssembly.validate` remains the typing/format authority;
validator rejection is reported explicitly, including proposals unavailable in that
runtime. V8 and shared producer versions participate in replay identities.
Opcode metadata carries the pinned WABT provenance and Apache license in
`src/index/semantic/wasm/`.

Structured stack/local merge values retain branches, loops and direct/reference
calls. Immutable internal table slots can establish exact indirect targets;
exported, imported, mutated or dynamically initialized tables produce bounded
may-target sets with an unresolved remainder. Exception payloads and handler branches
remain separate from uncatchable traps; tail calls discard the caller's handlers.
Unreachable instructions retain syntax without fabricated value flow. Memory/table/
global/data/element records retain conservative reads, writes, copies, initialization
and mutation dependencies. GC field aliases, shared writes, atomics ordering/wakeups,
relaxed SIMD choices, memory growth/view epochs and storage order remain unknown.

Host exports join decoded names/function indices per resolved instance. Static own
import properties join module/name pairs to resolved callbacks. Shared compiler CFG
summaries supply return and exceptional completions, including finally overrides;
rest/default parameters and literal multi-value arrays preserve positional channels
where analyzable. Host Memory/Table/Global candidates share module storage, while
Tag identity uses aliases when declaration authority is available. Async/generator
callbacks are not implicitly awaited. Numeric conversions, arbitrary iterables,
call-context effects, imported tag aliases and actual activation remain partial.

Limits per module are 64 KiB, 4096 vector entries/instructions, 256 locals including
parameters, 128 control frames, 32768 graph nodes and 131072 edges. Unknown opcodes,
component/experimental formats, unavailable bytes, cross-source instance aliases,
unsupported syntax, validation failures and budgets retain explicit coverage reasons.
Standalone eager/eligible-auto flow accepts a source-hash-pinned ref to its syntax
module anchor (local ID 0); coverage explicitly widens that selection to the entire
module. Text/declaration targets remain unsupported. Deferred binary local-flow tasks
use the shared frontier, leases, scheduler and normal generation publication. Each
task pins one retained module, decoder version and validator runtime. Manual drain
and after-index execution use a binary capability without creating a TypeScript
Program or compiler admission receipt. The scheduler reserves 64 MiB per module;
this is a capacity estimate, not a hard heap bound. Source verification surrounds
execution and rejects changed bytes. The targeted profile can select a pinned
module anchor and defer its local flow. Binary module anchors and derived analysis
use the existing syntax/analysis
partition split, so the shared replay fence invalidates changed analysis policy. Existing
host-boundary candidates remain available when module provenance is unresolved.

Format references: [core instructions](https://webassembly.github.io/spec/core/binary/instructions.html),
[core modules](https://webassembly.github.io/spec/core/binary/modules.html), and
[execution semantics](https://webassembly.github.io/spec/core/exec/instructions.html).

## Provider joins

Provider selection validates the complete source/context/reference inventory before
changing file facts. Conflicting immutable partition identities fail atomically;
identical duplicates are selected once. LSP call targets name actual invocation
records, excluding receiver/key-variable occurrences. Validated provider candidates
can join existing source function summaries within the same compiler group and
generation, using the shared argument/return/effect channels. Directional,
context-qualified exact declaration aliases may connect an external/provider target
to a retained source body; value/heap aliases and names alone do not authorize that
join. Call and construct targets stay distinct. The join scans at most 4096 edges,
8 alias levels, 256 queued aliases and 32768 traversal steps, retaining at most
32 targets per call; missing summaries and truncated
candidates preserve an unknown remainder. It does not infer external implementations
or provider-specific RPC protocols.

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

## Deferred analysis and compiler admission

Set `enrichment.bindings` to `deferred` and `execution.deferredDrain` to `manual`
to retain a durable pending descriptor. `after-index` permits bounded work through
the existing relations scheduler, with `execution.afterIndexMaxMs` as a cooperative
allowance. Synchronous compiler calls cannot be forcibly interrupted by this timer.
The `targeted` profile defers bindings and local flow unless explicitly overridden.

Task state and leases live in a separate semantic frontier SQLite control database.
Missing control-store capability leaves work deferred. Completion is acknowledged
only after normal whole-generation promotion. Changing generations produces a new
target request; old tasks are never retargeted by filename. Bindings, local flow and
cross-file flow can be selected through the experimental manual enrichment service.
Independent overlay publication and complete field/context-sensitive analysis are
not available. Local and cross-file deferred tasks retain durable descriptors.
Targeted LSP locations reuse the existing session independently of signature
completeness. Embedded JS/TS source snapshots retain exact local-to-container maps;
coarse or synthetic mappings do not claim exact bindings.

The compiler closure includes full context-qualified input bytes/files, transitive
imports, libraries and project counts. Configure build-wide admission under
`indexing.semantic.execution.compilerAdmission`:

```json
{"maxFiles":10000,"maxBytes":134217728,"maxProjects":32,"maxResidentBytes":536870912,"measurementHeadroom":1.25,"maxReceiptAgeMs":604800000}
```

These defaults cap the planned closure and reserve up to 512 MiB for an explicitly
requested unmeasured batch. This reservation is not an estimate of actual heap use
or a hard process-memory limit. A matching complete measured receipt may instead
reserve the observed process-wide RSS high-water mark with configured headroom,
never less than the closure input bytes. The observation includes unrelated process
memory and is not attributed solely to one Program. It does not guarantee future
cost. Receipt identity pins closure/compiler/runtime/phase inputs; expired or
incompatible measurements are unknown, not a measured zero. Unknown automatic cost
stays deferred. Explicit eager/manual work still must fit all closure, allocation,
scheduler memory-token and queue/global byte caps before Program construction.
Admission is rechecked inside the leased scheduler callback; scheduler oversize-idle
behavior does not waive compiler caps. Timers remain cooperative for synchronous
compiler work.

Save an explicit generation-pinned request using a real retained task ID:

```json
{"schemaVersion":1,"repoRoot":"<repoRoot>","generation":{"baseBuildId":"<buildId>","semanticRevision":0},"action":"plan","taskIds":["st1:<hash>"]}
```

```sh
pairofcleats semantic enrichment --request enrichment.json
```

Omitting `action` means plan only. Set `action` to `enqueue` to retain pending work in
the dedicated control store, or explicitly to `drain` to attempt supported selected
phases. Enqueue does not execute a compiler. Drain requires sealed compiler/config/
module-resolution authority and exact source/dependency hashes; unavailable authority
or over-budget admission leaves work pending. A successful drain publishes a fresh
whole generation through the normal builder, then acknowledges receipts and retains
old/new task lineage. The builder may rediscover/reparse source; targeted parse reuse
is not promised. Source changes are rejected rather than completing an old task
against new input. Experimental public surfaces remain qualification pending.

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
runtime lookup is separate from semantic trace.

Discover retained families, then query explicit immutable generation IDs:

```sh
pairofcleats runtime families --request runtime-families.json --all
pairofcleats runtime lookup --request runtime-query.json --all
```

Discovery requests contain `schemaVersion: 1`, `repoRoot`, `destination`,
`limits: {maxFamilies, maxScan, maxBytes, maxMs}` and `cursor: null`. A lookup request
contains `schemaVersion: 1`, `repoRoot`, `destination` and `request`, the strict runtime
query contract in `src/contracts/schemas/runtime-query.js`. Destinations resolve
relative to the repository and must remain within it or its configured repository
cache after resolving symlinks and junctions.

The nested query pins `repositoryNamespace`, the source `generation` and
`familyGenerations`. Selectors match capture IDs, executable/version/platform,
workload fingerprint and phase, session/process/isolate/worker, exact source hashes,
source record references and exact code lifetimes. Empty selector lists impose no
filter; nullable selectors use `null`. The library exports
`defaultRuntimeQuerySelectors()` and `DEFAULT_RUNTIME_QUERY_LIMITS`; the latter uses
32 records, 64 KiB and 250 ms. Every request supplies limits and `cursor: null` for
the first page. Opaque continuation cursors bind those exact selectors, limits and
family generations. `--all` streams bounded pages without launching a capture.

MCP exposes `runtime_families` and `runtime_evidence`; HTTP POST routes are
`/analysis/runtime-families` and `/analysis/runtime-evidence`. All surfaces share the
same destination boundary and saved-family service. Results separate observations
from derived claims and provide explanations and plan-only next-observation
proposals. Capture coverage and source-join counts remain explicit: a complete CPU
profile does not establish an exact source mapping. Current saved adapters project
direct observations; general causal derived-claim projection is explicitly unsupported.
Sampling does not prove all
executions or call counts. Native listing hashes from the custom interchange retain
their exact code lifetimes; lookup does not claim arbitrary V8 native-log support.

Saved capture comparisons and derived claims use separate strict schema1 requests
in `src/contracts/schemas/runtime-claims.js`:

```sh
pairofcleats runtime compare --request runtime-compare.json
pairofcleats runtime claims --request runtime-claims.json --all
```

The comparison service wrapper contains `schemaVersion: 1`, `repoRoot`, `destination`
and `request`. Its request pins `repositoryNamespace`, source `generation`,
`leftFamily`, `rightFamily`, exact `sources`, bounded `limits` and explicit `persist`.
Compatibility requires the same source inventory, build, runtime, workload fingerprint,
input shape, phase, instrumentation, scope and clock. Differences produce explicit
incompatibility reasons. Supported comparisons describe exact-source CPU sample
counts; they do not infer rates, call counts, equal code versions, timing alignment,
performance improvements or causality. Next-observation proposals require separate
authorization before any new collection or execution.

With `persist: true`, complete derived claim records and their supporting/contradicting
observation citations are saved as an immutable family under `claims/<claimGeneration>`.
The separate `claims/current.json` convenience pointer never changes the imported
observation pointer or source index. Lookup pins `claimGeneration`, source generation,
namespace, limits and cursor. It verifies cited observations and retained raw hashes
on every request; missing or tampered support is an error. Prior claim families remain
available. MCP tools are `runtime_compare` and `runtime_claims`; HTTP POST routes are
`/analysis/runtime-compare` and `/analysis/runtime-claims`. All surfaces use the same
repository destination authority and bounded service. General causal inference remains
unsupported.

Queries verify the manifest, registered lookup index, offset table and hydrated row
hashes. They do not read every raw artifact on each request; that distinction is
reported in the result's integrity fields. All imported generation directories are
retained, so lookup is not restricted to the latest convenience pointer. Families
without the versioned lookup index return an explicit unavailable/reingest error;
discovery labels those same-format retained families `unavailable-reingest` while
still listing available families. There is no old-format lookup fallback or migration. Reingestion preserves the saved inputs
and publishes a new immutable family when its projection changes.

The experimental registered `semantic-find` and `semantic-explain` operations remain
qualification pending. Find uses
exact AST/operator/invocation selectors, sourcePath/sourceUnitId selectors, chunkUid
ownership selectors or a recorded target candidate, and can compare
bounded ordered syntax. Literal/name/type/effect gaps are explicit; a matching structural
hash does not establish equivalent behavior. Cursors bind the exact generation, store
inventory and request. Explain returns static evidence classes and cited producer methods.

```sh
pairofcleats semantic find --request find.json --all
pairofcleats semantic explain --request explain.json --all
```

Find requests select an exact AST kind/operator/invocation kind, recorded target,
retained source path/identity or chunk UID. Source selection includes operations with
no chunk owner; chunk selection includes both primary and overlapping ownership.
For example, `selector: {"field":"chunkUid","value":"<search-hit chunkUid>"}`
resolves exact operation references without clients scanning the fact index.
The derived operation index is now version 2 and requires rebuilding older indexes;
canonical source/fact identities do not change. Source and ownership candidates
are distinguished from structural/target candidates and imply no equivalence.
Explain requests use the trace request shape. Find/trace/explain can explicitly choose
`backend: "artifact"` or `"sqlite"`; SQLite opens only the requested immutable
generation's `index-sqlite/index-code.db`, with no mutable-path fallback. Explain
returns source-unit/hash pins and bounded exact task suggestions containing separate
plan and enqueue requests; suggestions never execute automatically. Completed task
receipts resolve old deferred markers only when actual same-source/phase output exists;
actual partial coverage remains partial.

MCP names are `semantic_find`, `semantic_explain`, `semantic_enrichment`; corresponding
HTTP POST paths are `/analysis/semantic-find`, `/analysis/semantic-explain`,
`/analysis/semantic-enrichment`. CLI/MCP/HTTP share strict request and repository scope
checks. Structural similarity and modeled paths are not proof of equivalent behavior.


### Semantic evidence in ordinary context packs

Set `includeSemantic: true` in the shared context-pack request, or pass
`--includeSemantic` to the context-pack CLI. The resolved search-hit chunk UID
selects exact operations via ownership, including overlaps. If only a retained
source path is resolved, source discovery also includes operations without chunks.
The optional semantic section is independently capped at 64 KiB, in addition to
the primary excerpt budget: up to eight discovered operations, bounded ordered
arguments/names/ownership, one downstream witness sample and a retained-source
excerpt. It does not parse source, schedule enrichment, execute code or capture
runtime data. Unavailable families are explicit; corruption is an error.

`semantic.followUps` contains validated semantic_find/detail/trace requests with
repository and generation pins. When a page has a cursor, the follow-up resumes
that page in the same running service; normal cursor expiry/restart rules apply.
Otherwise it repeats the bounded query and can be used as a scoped starting point.
The textual renderer summarizes evidence counts; JSON includes exact records,
coverage, excerpts and follow-up requests. `semanticFederation.repositories`
retains separate sections for each selected repository, with fanout bounded by
`maxFederatedRepos` (maximum 16). Partial semantic evidence leaves the composite
coverage incomplete; a small witness sample never certifies exhaustive behavior.

Source selectors may include `range: {"start":10,"end":20}` for exact half-open
UTF-16 overlap discovery. The range must be nonempty and is valid only with
`sourcePath` or `sourceUnitId`. The indexed source bucket is filtered within the
normal work budget; drain cursors even when an intermediate page has no matches.

Structural fingerprint projection 2 includes hashes of exact retained literal text
(up to 4 KiB per literal) alongside ordered syntax. Numeric spelling, string escapes,
regular expressions and template text remain distinct. Missing/oversized retained
source makes the projection incomplete; hash matches are still structural candidates,
with binding, type and effect constraints unchecked, never equivalence probabilities.
