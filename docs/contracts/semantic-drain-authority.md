# Semantic drain configuration and publication authority

A manual drain captures one immutable effective owner at admission. Its identity
binds the canonical repository, repository-cache/builds publication root, existing
content-config projection, relevant semantic environment and resolved tooling
policy. The service clones supplied configuration before opening its source
inventory. Native/compiler dependency verification uses that same configuration;
it cannot independently reload a different tooling policy.

Execution revalidates the capture against the live trusted loader. It also checks
each candidate normal-builder configuration immediately after loading, before
recovery/cache mutation and before runtime storage admission. The builder still
loads current policy normally; the service does not force a stale snapshot over
revoked trust. Attachment checks the runtime configuration, actual repo-cache
owner and fresh direct child of the admitted builds directory. Publication checks
live/candidate authority again, alongside existing current-pointer, source,
dependency, lease, task-lineage and completed-output verification. Recovery uses
the same owner.

Changed authority throws `ERR_SEMANTIC_ENRICHMENT_STALE` with reason
`enrichment-authority-changed`. Diagnostics contain opaque expected/actual
identities, not private cache paths or commands. No automatic security changes,
symlink creation or promoted permissions are involved. An injected configuration
that differs from live authority rejects before new drain work or journal mutation.

Request identity is now `pairofcleats.semantic.enrichment-request.v2`, including
the captured authority hash. Journal names and recovery therefore cannot alias
another configuration's drain. Older journals remain historical and are not
silently acknowledged under the stronger identity. Their recorded data is
preserved; source task identities, immutable index generations and journal shape
are unchanged.

The existing content-config owner defines permitted nonsemantic changes. Cache
retention, logging and other excluded scheduling/runtime fields do not by
themselves invalidate this identity; cache publication location remains separately
bound. Relevant content, environment, tooling or trust changes require a newly
admitted operation. This conservative policy avoids a second drifting list of
build-affecting configuration fields.

The existing lease/journal/control owners settle failed drains. Independent
cleanup failures survive alongside the original failure. A stale operation cannot
publish elsewhere and then depend on recovery from its old root to notice.

The authored WASM production fixture uses normal source indexing and real builder
entry/runtime barriers. It covers live A-to-B switches with loaded and supplied
configuration, early injected-owner mismatch, unchanged A pointers, no B creation,
failed-journal/lease settlement and healthy A-to-A publication with a permitted
cache-retention change. Existing source/dependency mutation, cancellation,
lost-lease, native and compiler controls remain. Functional execution is deferred;
this implementation does not establish final-head Windows qualification.
