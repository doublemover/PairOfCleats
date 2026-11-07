# Native command catalog

Status: source implementation, unvalidated (2026-10-22).

The existing `workflow:run` protocol owns scope selection, describe, preview,
one-use launch, discard, published-status observations and scoped semantic next/disposal. No form can submit an
arbitrary executable. `tools/tui/operator/index-catalog.js` consumes the command
registry and the actual CLI option objects. Inline definitions needed by both
surfaces now live in `tools/shared/operator-cli-options.js`; the canonical CLIs
import those same objects. This is a definition move, not an additional CLI.

`describeWorkflowCoverage()` is the machine-readable coverage manifest. Every
stable/operator command has either a typed adapter or a concrete unsupported
reason. A new registry command without a disposition fails catalog admission.
Experimental commands are hidden by default; `X` in the native catalog explicitly
enables them for this session. Internal commands remain hidden. Disabling the
experimental catalog also revokes its existing preview tokens.

The catalog adds scoped setup/bootstrap, tooling doctor/detect/install, a loopback
API service, cache GC, context/graph/impact, architecture/test suggestions, risk,
map/evaluation/model-comparison reports and a restricted search microbenchmark.
Request-file semantic/runtime forms consume the existing strict canonical
schemas in their canonical owners. Semantic detail/trace/find/explain retain a
single process per query: `n` requests the next bounded page from that same
canonical runner and Esc disposes its volatile continuation. Opaque producer
cursors remain private to the child and cannot be replaced by UI requests.
At most four continuations live for five minutes and 128 pages; canonical query,
generation, cursor, work and byte limits can expire them sooner. Runtime-evidence
forms still retain one page. The request file must be
within the chosen repository and name that repository as `repoRoot`; file bytes
are bound into the expiring preview. Explicit report output paths must also stay
inside the selected repository, and their observed identity is rechecked before
spawn. This check does not replace a command's own atomic publication authority.

Known report/map/evaluation/microbenchmark output flags also feed the existing
artifact collector. An exact output filename within the selected repository can
receive the existing checksum/identity-verified open, copy and export actions;
changed or out-of-scope files cannot. Web maps remain files and native inspection
does not render their 3-D scene. The native map form excludes serve/browser/TLS
options until a dedicated verified preview adapter exists. Artifact Open uses
the existing trusted editor launcher; it does not claim to open a browser.

Every launch presents its canonical argv or explicit direct API owner, selected scope, known cache impact,
input/output observations and an effect explanation. Setup always uses the
canonical non-interactive mode. Credential flags, raw environment/command text,
shared cache-root overrides and unauthenticated/non-local API bind options are
not admitted by native forms. Credentials use the existing private trusted
environment or configuration handoff. Setup completion separately observes the
actual bootstrap verifier and runs canonical tooling doctor; failed, missing or
incomplete verification cannot become ready merely because installation exited.

API launch is fixed to `127.0.0.1`, verifies the canonical startup identity, and uses
the supervisor's exact job/process identity and existing cancellation/shutdown
owner. After this exact child reports its listen event, a bounded two-second,
8 KiB request to its fixed loopback `/health` path records endpoint health. It
admits no redirects or producer-supplied URL. An occupied-port startup cannot
probe an unrelated listener as if owned; startup failures stay failures. Private
API token environment handoff is reused without putting credentials in records.
A running PID does not establish endpoint health. MCP uses a session-owned
client attached to the canonical legacy framed server; initialize and bounded
tools/list responses establish protocol health only. It admits no arbitrary tool
calls or external server attachments. The bounded transport retains cancellation
capacity until response settlement or owned process-tree close, and disposes on
scope change and supervisor shutdown.

Indexer status/work uses the existing durable queue, claim lock, worker, executor,
lease-renewal and completion owners. Select a workspace and a contained service
configuration with 1–32 inline, existing registered repositories, all enabled
members of that workspace. Its exact config, queue directory and membership
identities are reviewed and rechecked. A trusted predicate under the claim lock
selects only ordinary index jobs for those repositories, leaving foreign and
custom-argv jobs unchanged even during claim-side duplicate suppression. Admission
must synchronously return a boolean before any queued-job mutation. Native cancellation stops only this worker's claims
and executions and awaits canonical settlement; it never writes global service
shutdown/resume state. Embedding queues, sync/clone, enqueue and recovery of
unrelated abandoned claims remain outside this adapter.

Storage list/explain/inspect/doctor and cleanup plan/apply invoke the existing
storage APIs. Roots come from current machine environment, and review states
their shared scope. Apply retains the exact complete canonical plan privately,
shows its plan ID, and requires a fresh Enter confirmation. Caller-supplied plan
files/IDs are not admitted. The canonical owner rechecks root markers, file
identity/content and its existing exclusions. Only its producer-marked command
probe adapter is eligible; durable evidence and unregistered data stay preserved.
Incomplete/protected plans cannot launch apply; later protection produces skipped
or failed canonical results. Physical reclaimed bytes remain unknown.
Storage configure plan/apply and migration plan/apply/rollback/status each retain
an explicit native unsupported reason until their exact root/configuration,
retained plan, lease and recovery views exist; their canonical CLI owners remain
the available surface.

Cache GC retains its canonical scope and active-owner exclusions. The legacy
whole-root clear form directs operators to canonical storage cleanup. SQLite
compaction and LMDB build use the canonical authenticated child-delegation owner.
Their preview pins the current published generation, pointer bytes, selected
backend paths and observed metadata, exact realpath entry bytes and arguments.
Only code/prose modes with canonical default backend paths are admitted;
historical/snapshot inputs, path overrides, legacy cache-root generations and
`NODE_OPTIONS` remain blocked. Metadata observations are not database checksums
or backend readiness evidence.

Other active supervised jobs block maintenance. The exact in-memory launcher
instance is excluded from that check; a reused job ID cannot exclude another
job. New work is fenced before search, artifact and semantic continuation owners
are actually disposed and the exact retained-reader lease receipt is issued.
That private receipt enters the existing repo-access exclusion and authenticated
IPC admission before the child entry's readers. The canonical command independently
rechecks its command digest, effective cache root and contained generation/targets
before opening native databases; every native handle joins its closure owner.

Only successful canonical ownership completion after authenticated handle and
descendant closure plus actual child close resumes admission. A cancellation or
kill request does not establish settlement. Unknown or failed closure keeps the
existing exclusion and local cache fence pending, including after the job ends.
Status then reports ownership metadata without reading publication artifacts,
and artifact collection is fenced too. There is no native force-unlock action.
Owners without this explicit reader-drain integration keep these catalog entries
unsupported.

The experimental microbenchmark adapter uses only sparse/dense/hybrid search,
forces build/clean off, and bounds run/warmup counts to ten. Full index/corpus/
backend qualification continues to require its separate explicit CLI plan.

Native fields use the supplied schema for literal strings, numeric JSON, enum
cycling, boolean toggles and bounded string-array item addition; `e` retains an
advanced JSON editor. Supplied numeric/string/array bounds and a bounded list of
enum choices appear beside the selected field and editor. These hints do not
coerce drafts or replace canonical validation. `false`, `0`, `null` and unset are distinct values. Settings
Delete is an explicit remove operation through the existing schema/revision/
scope-bound preview and atomic commit; it is not a JSON null sentinel.

Authored regression sources cover registry parity, exact argv, experimental
visibility, failed ownership admission, typed values, inert paste and source
identity. None have been executed in this development span. Actual native
keyboard/request/supervisor/result, frame, ConPTY, cancellation and platform
acceptance remain deferred; this document is not a qualification receipt.
Source-only fixtures also cover pre-startup protocol admission, canonical task
activity events, API startup/occupied-port isolation, private semantic
continuations, exact storage plans and scoped queue cancellation/suppression.
Delegated-maintenance sources cover exact command digests, current-generation
and target changes, actual asynchronous drain, reused launcher IDs, pre-child
conflicts, cancellation and unresolved closure. Injected owners do not qualify
real IPC, SQLite/LMDB handle teardown, hard-kill recovery or native host behavior.
