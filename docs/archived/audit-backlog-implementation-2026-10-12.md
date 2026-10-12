# Audit backlog implementation receipts, 2026-10-12

Status: Implementation complete; focused acceptance started
Baseline: bb9901ac808a24629c8004ddd2479006716498be
Branch: codex/audit-backlog-implementation-20261012

[The canonical roadmap](../roadmap.md) owns current item status and execution order.
This record preserves evidence and limits, not an independent active task list.
The user expressly authorized implementation; attachment stopping rules describe
the preceding audit and do not override that request.

## Baseline and setup

The official Node 26.8.1 distribution checksum matches its published SHA-256.
The evidence archive's 41 SHA-256 entries match. The audit remote was verified at
the baseline; the task branch starts there, rather than the older main checkout.
Official bootstrap installed the locked dependencies and patches. Its optional
ONNX library download hit a direct-network connection failure; supported
`tools/setup/rebuild-native.js --repair` then verified required native packages and
patches and wrote a real readiness receipt. The changed grammar activation probe
has now passed supported `--verify`: all required packages load and every
registered native grammar route activates its bounded sample. The refreshed
receipt records exact package versions, Node 26.8.1 and ABI. This is setup/parser
activation evidence, not SDK or full-project qualification.

Rust 1.88 plus rustfmt/clippy are task-owned. `cargo check --locked` and clippy
passed the native TUI source; no Rust tests were run during implementation.
LLVM/clangd 19.1.7 came from signed Debian snapshot metadata and downloaded packages
extracted to a task-owned prefix. Both executables report their real version.
Chromium 141 came from Playwright's official archive; after Node's extraction
stalled, Python verified ZIP CRCs and extracted the task-owned browser. Version
inspection passed; no browser workflow was run at this checkpoint.
MiniLM q8 model/tokenizer assets are verified against the pinned official revision;
no inference or measurement was executed during implementation.

## Frozen handoffs

Storage owns canonical bundle paths, immutable manifest-bound snapshots, cache
writer leases and replay verification. Embeddings owns Stage3 consumers and payload
refresh, preserving verified source/dependency identities. Manifest schema 6
uses compact dependencies with an 8 MiB publication bound and manifest-last
replacement. Spill inputs retire only after replacement output closes.

The shared contained-file contract opens and bounds bytes, checks descriptor/path
identity, hashes those exact bytes, and returns the same buffer for parsing.
Runtime SQLite paging uses a verified serialized snapshot plus verified offsets
and exact row hashes. Imports and claims share a destination lease and retained
physical byte accounting; failed promotion does not forget admitted retained bytes.
Explicit semanticContext pins repository/store/manifest for operation attribution.
Raw source evidence and operation authority are distinct.

Semantic versions have one writer. Shared expression dependencies and call-owned
rest channels feed CFG/value-slice together. Ordered plain-object/array and small
verified typed-array snapshots are precise within their proven subset; escapes,
loops and unsupported structure retain conservative frontiers.

Enumeration accepts queryless requests only with an effective filter, retains
fuzzy filters alongside explicit strict facts, and invokes no embedding model.
SDK cancellation waits for owned teardown; progress token zero is valid. HTTP
listener authority and reader lifetimes have distinct regression fixtures.
Removed context expansion accepts omitted/zero compatibility values without a
removed flag, and rejects positive requests before spawning.

## Quality and TUI changes

Timeout classification is diagnostic: failed or timed-out JSON always exits 1,
including pass-looking output. Mandatory gate removes timeout allowance and
retains logs on every terminal outcome. The first focused acceptance must prove
this contract before other fixture receipts are trusted.

Excerpt caches hash current contained source bytes even under a pinned generation.
Output identifies working-tree previews and indexed-hash drift; completeness
requires verified indexed identity. Direct and prefetched reads share the policy.
Test discovery keys the selected generation plus actual sorted inventory and
caches the truncation envelope. Root test directories and explicit supported
patterns share consistent discovery authority.

Native setup probes activate each registered grammar through the same binding
normalization used by indexing, recording package version/Node ABI separately
from provider/project qualification. Loadability alone is not activation.

The native TUI owns graceful supervisor shutdown and bounded escalation, including
Quit, terminal errors, and supervisor failure. Linux adopts and reaps owned
orphan descendants; Windows uses an owned kill-on-close job. Platform behavior
requires separate native receipts. Final job states are drained before snapshot
save; abrupt supervisor loss cannot retain a running final state.
Result collection obeys requested byte caps, retains zero bytes when disabled,
and reports complete/truncated/invalid JSON independently of process status.
Actual native PTY fixtures and real supervisor byte-cap fixtures are source-written
but have not run at this checkpoint.

## Validation policy and current limits

Scoped ESLint formatting/lint and Node 26 syntax checks pass reported completed
batches. Python compilation and Rust type/lint checks are separate receipts.
There is no top-level typecheck script or TypeScript project; JavaScript syntax
checks are never called typechecks. No product tests, inference, index campaigns,
or performance measurements were run during the implementation phase.

Detailed local logs are under `/workspace/audit-work/receipts`; they are execution
artifacts outside the repository. Focused acceptance and measurement summaries
will be appended here only after execution. Completion requires all 45 items'
applicable evidence, with unavailable native platforms or assets explicitly open.

## Integrated lightweight boundary and first acceptance

Whole-tree ESLint formatting passed. All 291 changed/new JavaScript files passed
Node 26 syntax checks; two changed Python files compiled. Rust cargo check/clippy
passed Linux, and cargo check passed the Windows GNU target. Cross-target checking
is not native Windows execution. There is no typed source contract or top-level
TypeScript project requiring a meaningful scoped tsc invocation.

Governance/config/schema/script generators refreshed their owned outputs; lane
audit reports zero missing IDs, duplicates, manifest mismatches, or timing overruns.
Actual readiness remains verified with 33 native grammar activation records.

The first product fixture was `runner/harness/timeout-pass-signal-classification`:
one pass, zero skipped, zero retries, 2.954 seconds. It exercises real hanging child
commands under default and deprecated timeout-flag paths. A retained direct
reproduction separately exits 1 and reports one failed result, `timedOut:true`,
`timed_out_after_pass`, and one attempt. This deliberate rejection is expected
negative evidence, not a failing regression or passing timeout.

Local receipts: `/workspace/audit-work/receipts/qual001-focused.json`,
`qual001-direct-hang.json`, `qual001-direct-hang.exit`, and both runner log dirs.
Mandatory workflow contracts and the integrated final gate remain pending.

## Focused acceptance checkpoint

The same four agents completed their bounded selections. Embeddings has 53
unique passing IDs (47 planned plus six added regressions); interfaces has 29,
and storage/runtime has 29. Their original failures remain recorded separately;
none is counted as a pass, retry, skip, timeout allowance, or native redo. One
SDK fault-injection fixture timed out at 30 seconds: after transport close was
intentionally rejected, the test retained its own un-aborted client RPC. The
fixture now aborts that owned RPC after asserting production queue cleanup; the
affected rerun passes without increasing the deadline.

Root quality acceptance covers mutable-source excerpt provenance, generation and
inventory discovery freshness, root test directories/patterns, and actual grammar
activation. The contained-file replacement fixture first exposed verification
order hiding the path-identity error; descriptor/path verification now precedes
final stat classification, and the affected singleton passes. Existing context
fidelity, excerpt matrix, risk API and risk assembly cases also pass. TUI capture
covers disabled/text/JSON, exact byte limits, Unicode/chunk boundaries and a
1.2 MiB JSON result after flow-credit exhaustion; complete output remains JSON,
while invalid/truncated states remain distinct from command success.

Actual Linux Rust TUI qualification passes Quit, terminal-output failure and
real supervisor loss with the production Node supervisor and a deliberately
owned detached descendant. Four owned PIDs disappear in every case; terminal
settings restore; final states are cancelled/cancelled/failed. The first native
attempts exposed fixture import/PTY terminal negotiation issues and then a real
Linux portability issue: this kernel omits task/PID/children. The guard now builds
a bounded parent-ID ancestry inventory from process stat records and rechecks
starttime before signaling, preventing PID reuse from transferring ownership.
The three latest native fixtures pass in 0.595, 0.575 and 0.669 seconds. Rust
fmt/check/clippy and Windows GNU cross-check pass after that correction. No
native Windows or macOS execution is available; cross-checking is not that proof.

Local aggregates: `receipts/embeddings/acceptance-summary.json`,
`receipts/interface-validation/verified-final-summary.json`; root receipts
`root-quality-focused.json`, `root-contained-recheck.json`,
`root-context-focused.json`, `root-tui-capture-focused.json`,
`root-native-quit-ancestry.json`, and `root-native-errors-ancestry.json`, all under
`/workspace/audit-work`. These task-owned files are not clean-checkout fixtures.

Semantic artifact/SQLite trace acceptance exhausts both backends and rejects
truncated traces. The shared two-call/ordered-copy/snapshot/MessageChannel/template
witness passes cold and warm publication with an explicit 1 GiB compiler fixture
budget; the default 512 MiB admission remains unchanged. Native C, real browser,
real-model measurements and serial runtime-cost qualification are still pending
at this checkpoint; the first browser launch failed before initial DOM readiness
and is retained as a failure.

## Native C and public transport closure

Actual clangd 19.1.7 C production passed in 17.850 seconds; final native authority
passed in 7.613 seconds, each one attempt without timeout, skip or redo. The
initial failures exposed a copied-VFS document URI diverging from the frozen
physical compile-command entry, and optional legacy work consuming required
semantic definition budgets. Native documents now use admitted hash-bound
physical C URIs. Semantic and optional definition controllers share the unchanged
health-reduced total cap while semantic work retains its reservation across
parallel documents. Health/quarantine still defer. lspBindings version 6 prevents
reuse of prior routing/funding meaning. A stale fixture reconstruction request
was also corrected to supply exact completed task IDs.

The actual route publishes binding and exact call-target evidence, verifies
source/dependency/generation lineage and reconstructs after deleting the mutable
control store. Its inventory seals 85 ELF/toolchain files, 277,598,411 bytes, and
uses the existing 536,870,912-byte policy reservation. Actual native child RSS is
unmeasured: automatic cost qualification remains explicitly unavailable. This
manual/deferred C binding route is not native compiler value-flow, other-language,
project-build or unrestricted provider qualification.

A runtime-cost sample accidentally overlapped one native correctness attempt
because a prior free-slot message became stale while source corrections were in
progress. Both receipts retain that context and make no serial performance claim.
The cost sample also refused an explicit 16 MiB reservation. The corrected
measurement harness persists independent outcomes and account reconciliation;
a fresh serial sample retains that cap and its larger-scale refusal.

The interface lane closed actual legacy handshake/cancellation, SDK handshake,
MCP option mapping through the canonical parser, and unchanged Python temporal
filter payload through HTTP. It now has 33 unique passing focused IDs. Browser
resource diagnostics found an actual same-origin module GET receiving 403 under
default CORS; exact trusted same-origin requests now load, while foreign/null
origins, forwarded authority spoofing, and unauthenticated data remain denied.
Focused route/Host regressions pass; actual browser workflow is still pending.

Embedding acceptance now has 56 unique passing IDs after a concrete sparse ANN
fallback repair. A lazy loader function alone no longer proves dense data exists;
default ANN on embedding-off artifacts preserves sparse/MinHash retrieval and
avoids a model call. Present unknown/stale dense identity still fails explicitly.

## Bounded serial measurements and model qualification

Storage's final serial runtime matrix completed 22 operations and one clean
1024-node refusal under its unchanged 16 MiB admission cap. The refused operation
retained 156,199 bytes accounted against actual physical inventory, closed 20/20
descriptors, and preserved the previous readable pointer. Saved profiles are
synthetic: the indexed function was never executed. A 1/4/8-family cohort at 32
nodes opens exactly 1/4/8 families and verifies 67,325/264,827/528,163 bytes on
both first and continuation pages. Eight-family retained inventory is 987,379
bytes; conservative reservation peak is 1,613,613 bytes. Matrix whole-process
RSS peaks at 961,179,648 bytes including published-source setup/prior cohorts;
this is not runtime-only memory, a plateau, device I/O or production latency.
SEM-005 owns retained-destination admission/accounting; SRC-006 owns opened-byte
reader integrity. Their evidence must not be conflated.

Verified warm replay reduces semantic descriptor reads from 191,672 to 83,358
bytes unchanged, and 82,316 to 44,897 with one source change. Mandatory current
source reads (20 bytes) and actual copy bytes (35,275) stay unchanged. Process CPU
during hash calls is measured but is not isolated hash-exclusive thread CPU.
Spill qualification forces four levels and 20 merge groups, preserves rows and
offsets, peaks at 2,148 working bytes for 1,190 input bytes, ends at zero, and
covers closed-output retirement plus all injected failure paths. The observed
37.72 ms fixture wall time does not establish full-index throughput.

Official q8 MiniLM inference first failed the prepared batch/single cosine
threshold 0.999. Independent real native feeds reproduced 0.985490/0.991521;
production pooling matches direct native pooling with cosine approximately 1.
The graph has DynamicQuantizeLinear24/MatMulInteger36. This bounded numerical
limit belongs to the selected q8 native model, not feed aliasing or adapter
pooling. Original failed threshold receipts remain failed. Verified immutable
fp32 weights at the same revision, in a separate asset directory, pass the
unchanged strict threshold (0.999999995/1.000000001), actual independent feeds,
shared-session peak one, disposal, wrong-type rejection and recovery in 885 ms.
Neither model precision defaults nor process fallback are changed.

The explicitly selected q8 provider experiment embeds 64 short texts at batch
4/8/16: wall 44.86/32.75/31.60 ms, native busy 37.83/31.48/30.46 ms, padded
work 260/264/272 tokens; one initialization is 260.05 ms. Actual process threads
increase 7 to 11, with 11 during inference and CPU-tick changes on 8/4/3 matched
threads. Provider attribution remains unknown. These fixed strings are a packing
mechanism sample, not a calibrated quality or production throughput corpus.

The real two-file Stage3 cold run emits seven 384-dimensional vectors in two
batches, 566 source/1,242 padded tokens, 200 ms compute, 192.01 ms native busy,
and 260.31 ms initialization. Four writer tasks record 19.42 ms encoding and
254.81 ms write time; peak 102,352 bytes is below 268,435,456. Terminal pending
work/producers/preparing/bytes are all zero. Repeat reuses both files with zero
compute batches, while still paying 253.76 ms provider initialization and 5 ms
probe. Both durable attempts share verified identity v4/key. The normal cache
owner ignored an untrusted prepared cache.root and used the unique task repository
key; authoritative state/meta receipts were copied outside the repository. An
initial unsupported task config key refused the throughput command before
provider initialization; it was corrected in task-owned config and retained.

Final local measurements: `receipts/storage-qualification/storage-02-summary.json`
and `receipts/embedding-real-cpu-summary.json`, under `/workspace/audit-work`.
Full-corpus quality/scale, persistent neural workers, provider parallelism,
CUDA/DirectML/CoreML, native Windows/macOS and hardware GPU remain unqualified.
The default inline/Worker behavior and opt-in processFallback=false remain safe.

## Final actual browser acceptance

Chromium141/Playwright1.56.1 completed 11 actual service/browser/Worker and
independent Three.js workflows in 19.076 seconds including awaited cleanup.
Five screenshots were inspected. Service cursors read five generation-bound
artifact pages before selecting actual snapshot.ts alias.slice() CallExpression
span [110,123], verified against retained source bytes/hash and exact HTTP detail.
Catalog/artifact/detail, complete-envelope download, strict facts/scalars, ranked
order/scores, stale-generation view retention, cancellation, saved observation
and separate immutable claim all pass. Synthetic saved times remain labelled;
no live capture or causal certainty is claimed.

An injected real Worker stall terminates in 1,043 ms and preserves SVG. Actual
Three.js keyboard source selection and injected WebGL unavailability preserve
a usable hierarchy/inspector. Observed WebGL2 is ANGLE Vulkan SwiftShader,
contextLost:false, 844x390: this is software rendering, not hardware GPU capacity.
Runtime query opens one family and verifies 42,753 bytes for one 3,636-byte record.
Desktop, mobile portrait and mobile landscape footer clear main/toolbar/editor
and wrapped controls. Internal diagram scrolling remains intentional.

Browser attempts01–03 failed and are retained. Attempts04–05 passed their narrower
machine assertions but screenshot inspection exposed footer/control overlap;
neither is full visual acceptance. Owned CSS fixes and stronger button/status
bounds plus spanned CallExpression selection close that gap in attempt06.
Final receipt, visual-review.json and five PNGs are under
`/workspace/audit-work/receipts/interface-browser-qualification-20261012-06`.
The interface aggregate has 33 unique passing focused IDs and retained initial
nonpasses, including the original SDK timeout. Native Windows/browser hardware,
external deployment/proxy qualification and optional Perfetto remain separate.

## Final integrated acceptance

All 45 items are implemented, lightweight-checked and focused-tested with their
applicable bounded qualification and explicit limits. The consolidated owner/root
acceptance contains 148 unique passing IDs; no accepted case uses retries, skips,
timeout allowance or native redo. Initial nonpasses and deliberately negative
QUAL-001 timeout output remain separate. Actual native/model/browser experiments
and saved synthetic runtime costs are additional receipts with the scopes above.

Final whole-tree ESLint format/lint, 312 changed/new JavaScript syntax checks, two
Python compilations, Rust fmt/check/clippy Linux and Windows GNU cross-check pass.
Syntax is not JavaScript typechecking; this repository has no TypeScript project
or typed source contracts for a meaningful scoped tsc invocation. Governance
refresh finds zero missing/duplicate IDs, manifest mismatches or timing overruns.

The prescribed front gate passes config budget, environment usage, generated
freshness, command surface, mandatory workflow contracts, 39 gate cases in 25.976s,
and final diff checks. The generated audit first caught required roadmap metadata
and historical anchors omitted during consolidation; restoring those contracts
fixed the affected check without weakening tests. Local original failures remain.
Final link/USR documentation closure also passes two strict focused cases.

Validation ran against the authorized working tree before publication, starting
from audited HEAD bb9901ac808a24629c8004ddd2479006716498be on branch
codex/audit-backlog-implementation-20261012. Final changed implementation file
hashes are recorded in
/workspace/audit-work/receipts/final-validated-implementation.json; this identifies
the source checked and avoids implying that baseline HEAD alone contains the fixes.
No push, PR, merge or hosted CI had been performed at this validation checkpoint.
Publication is recorded in the branch history and its pull request; the bounded
validation receipts and qualification limits above remain revision-specific.

Local final receipts: final-focused-acceptance-summary.json, final-source-syntax.json,
final-rust-static.log, final-front-*.log/json, final-doc-focused.json, and
item-status.json under /workspace/audit-work (the status file is at that root).
The canonical roadmap remains below 20,000 bytes in LF and CRLF forms. These local
execution files are author-workspace evidence, not promised clean-checkout assets.
