# Retained build recovery through the core API

The core `buildIndex` API accepts an exact retained generation for read-only
inspection, validation, publication retry and independent graph validation.
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

Explicit missing-stage resume and ordinary compatible failed-generation selection
are the next source implementation span; this API does not yet authorize them.
Runtime qualification of the new graph controls is deferred until the shared
source wave is frozen. Earlier author-workspace receipts describe their own source.
