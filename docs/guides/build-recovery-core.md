# Retained build recovery through the core API

The core `buildIndex` API accepts an exact retained generation for read-only
inspection, validation, publication retry, independent graph validation, historical
resume, current-source refresh and a clean new generation.
Command registration and UI projection consume this API through their owners.

```js
const plan = await buildIndex(repoRoot, {
  recovery: { action: 'inspect', operation: 'validate', indexRoot: retainedRoot }
});
const result = await buildIndex(repoRoot, {
  recovery: { action: 'execute', plan }
});
```

Inspection reads bounded owned metadata without taking a writer lock, parsing
source, loading models or changing `current.json`. An explicit missing root never
falls back to current/latest. The plan binds repository, generation, selected
modes, configuration, metadata and pointer identities. Execution checks these
before and after normal writer admission. Validation keeps the generation;
publication additionally checks completion evidence, runs normal validation and
uses the existing pointer comparison and publication owner. Original failed
attempts/phases remain historical evidence in the same build state.

A completed plan has a durable result in existing build state. Repeating it
revalidates the retained authority and reports `alreadyComplete`, preserving the
original recovery attempt id and avoiding another pointer write. A later pointer
change is reported separately from the historical publication result.

Stage2 drains writers and seals its mode before optional embedding callbacks.
The completion in build state and the publication extension bind source/discovery,
stage dependency/policy identities, observed implementation/bootstrap identity,
originating attempt, family validation and every manifest-owned output hash.
A contained immutable copy preserves the original semantic base/revision while
Stage3 replaces mutable mode files. Interrupted copies have no final descriptor
and grant no capability. No physical links or second storage engine are used.

Graph capability is separate from vector/SQLite readiness, aggregate attempt
success and normal search/current selection:

```js
const plan = await buildIndex(repoRoot, {
  recovery: { action: 'inspect', operation: 'graph', indexRoot: retainedRoot }
});
const { graph } = await buildIndex(repoRoot, { recovery: { action: 'execute', plan } });
const metadata = await buildIndex(repoRoot, {
  recovery: { action: 'open-graph', indexRoot: retainedRoot, capabilityId: graph.capabilityId }
});
await withBuildGraphCapability(repoRoot, {
  indexRoot: retainedRoot, capabilityId: metadata.capabilityId, abortSignal
}, async capability => {
  return actualMapConsumer({ indexDir: capability.indexDir });
});
```

The callback must remain active until its original resources settle. Unconfirmed
consumer cleanup retains the original reader lease; the thrown error exposes
`releaseGraphReader()` for explicit reconciliation after the child settles. No
automatic retry or release based on an unrelated idle observation is performed.
A metadata-open response is a description; consumers use the callback API for
subsequent artifact reads.

Graph validation declares chunk/file metadata, file/repository/graph relations,
symbols, symbol occurrences/edges and chunk identity map as required. It reuses
canonical readers/schemas, identity reconciliation, the actual map-member join,
relation endpoint/count checks and semantic partition/source verification.
Coverage records mapped/unmapped graph edges and optional data/control flow.
The receipt binds its validation policy, immutable descriptor, semantic revision
and coverage hash. Missing required families or contradictory identities do not
grant readiness. Historical roots can gain graph-only authority through explicit
validation; their unknown historical source/producer facts stay unknown and do
not grant Stage2 reuse. Graph-only copies omit vectors/SQLite.

Typed errors include `ERR_RECOVERY_PLAN_STALE`, `ERR_RECOVERY_BUSY`,
`ERR_RECOVERY_VALIDATION`, `ERR_RECOVERY_GENERATION_MISSING` and
`ERR_GRAPH_CAPABILITY_UNAVAILABLE`. Post-publication bookkeeping failure reports
`ERR_RECOVERY_POST_COMMIT` and `publication.status: 'published'`.

Durable attempts can be compared through the same core API:

```js
const { comparison, lines } = await buildIndex(repoRoot, {
  compareAttempts: {
    before: { buildRoot: firstRoot, attemptId: firstAttemptId },
    after: { buildRoot: secondRoot, attemptId: secondAttemptId }
  }
});
```

Comparison distinguishes changed, unchanged and unknown evidence. Source and
policy identities reuse preprocessing hashes. Requested, admitted and observed
workers remain separate. Failed/active attempts are partial; overlapping mode
work is not summed into whole-run totals. Changed settings are correlations and
missing historical/native/loaded-module evidence never proves exact sameness.

Explicit historical resume uses `operation: 'resume'` and `resumeTarget: 'stage2'`
or `'full'` in the inspected plan. It rejects a generation selected by any normal
current mode, missing immutable source authority, changed configuration, stale
producer/bootstrap identity, changed source/discovery membership and changed
stage dependencies. Execution performs fresh canonical preprocessing before any
restore. Compiler, native and binary dependency inventories are revalidated by
their existing semantic authority owners; missing authority cannot establish
compatibility. Complete modes restore into the same retained generation and keep
the semantic base/revision; missing modes run the existing indexer. Backend work
uses the existing Stage3/Stage4 owners under a borrowed in-process writer grant.
A serialized plan/options object cannot fabricate that grant.

Import resolution has a separate dependency closure from compiler inventories.
Until its existing owner exposes whole-stage verification, code with import
relations cannot reuse a completed stage. Ordinary builds recompute and record
`import-resolution-dependency-inventory-unavailable`; explicit historical resume
fails closed. Compiler inventory or source equality does not grant that missing
authority.

Resume defers all pointer publication until the reviewed transaction completes
normal validation. Cancellation, queued/unadmitted backend work and any failure
leave the generation retained. Repeated successful resume validates exact output
identities, reports `alreadyComplete` with the original recovery result and makes
no pointer write. Transactions are bounded to sixteen completed results in the
existing state owner. Expensive work counts remain mode scoped; unavailable
recomputed-file counts stay null. Plans explicitly mark unresolved model download
and disk-space requirements unknown instead of inventing a zero-cost promise.

An ordinary build or explicit Stage2 invocation enumerates at most 512 owned
metadata entries and can admit one unambiguous failed/aborted candidate. The
normal requested build still determines its stages and publication behavior.
The same exact source/producer/policy/dependency checks run before any restore;
an incompatible/corrupt checkpoint causes clean recomputation with a durable
reason, while operational/resource failures remain failures. Ambiguous or
truncated inventories are explicit and do not silently select the newest root.
Watch/cache-rebuild/explicit-root paths do not use this candidate selection.
`recovery.action: 'candidates'` exposes the same bounded metadata offers.
`operation: 'refresh'` and `'clean'` are separate reviewed actions. Both allocate a
new generation through the normal runtime at execution, so planning reports the
destination root unknown with an explicit allocation reason. They consume the
current working tree and preserve the selected historical root. Clean disables
whole-stage and opt-in per-file incremental reuse; neither action deletes caches.
Their stage2/full target, required validation, pointer comparison and idempotent
completion follow the same transaction. They cannot be mistaken for historical
resume when source inputs changed.

Runtime qualification of these source controls is deferred until the shared
source wave is frozen. Earlier author-workspace receipts describe their own source.

Stage reuse also requires actual published file metadata to match SHA1 hashes
captured alongside SHA256 during the existing preprocessing read. This adds no
source-tree read pass. Missing processed-file hash/size/coverage evidence leaves
the snapshot valid for historical inspection but unavailable for whole-stage
reuse. Unresolved source-read closes and best-effort statistics/sample failures
retain their canonical original resource owners.

If a recovery child or the final writer release remains unresolved, the error
retains `releaseRecoveryWriter()` and the exact writer owner. Reconcile the
original child first, then invoke that explicit control; child settlement alone
does not report the writer released. Post-commit cleanup errors retain the
published destination identity and these same controls.
