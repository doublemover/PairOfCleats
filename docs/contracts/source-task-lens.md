# Exact-source task lens pilot

Unvalidated first slice of #1511. The pure materializer consumes scoped retrieval
candidates and owned immutable source snapshots. It reuses existing diversity
selection and the complete context-response byte-budget owner. Mandatory exact
source that cannot fit yields explicit overflow plus the retained owner handle;
summaries never replace it while claiming the same support.

Each facet preserves source/observation/role/world identity, qualifications and
an exact expansion route. Several roles may reference one observation without
creating independent corroboration. Selection and presentation identities are
separate. Serialized byte accounting includes the final JSON newline and counter.
No actual-token count is claimed without an admitted tokenizer/renderer adapter.
Source admission reconstructs the canonical source manifest from the owned bytes
and checks every field, including source ID, repository/path, coordinates and line
starts. A matching byte hash beside forged metadata is insufficient. Both the
source lens and package facet use this shared admission owner.
Snapshot capability and manifest fields must be ordinary own data fields;
metadata accessors are rejected before evaluation. The full manifest also passes
the canonical source envelope validator before identity reconstruction.

`materializeRetainedSemanticTaskLens` now bridges selected canonical semantic
record refs to the existing lens. It checks the requested generation/repository,
hydrates exact retained source records under a shared source-byte allowance and
derives spans from those records. Caller role/ranking declarations do not supply
source coordinates or upgrade binding coverage. Mapped/generated sources require
an independently qualified original-source adapter and currently remain
unavailable on this bridge.

Both materializers canonically copy role, candidate, world and expansion-handle
metadata before consuming it. The retained bridge pins every caller selection
before its first awaited store read, then copies the complete selected-record
response before further source reads. Later caller mutations cannot retarget
source refs, required roles, build context or the retained expansion owner.
Metadata accessors are rejected without invocation; source arrays also require
ordinary own data entries. Caller metadata has a 4 MiB encoded allowance. The
retained bridge charges selected record and source-manifest metadata against
that same allowance while actual source reads retain the existing shared byte
bound. These encoded admission limits do not claim total process-memory bounds.
Incomplete record responses and cancellation after a store read fail before a
source lens is returned. These query ownership changes create no new producer or
public default acquisition surface.

Compiler and LSP session initialization and compiler publication use the same
`readRetainedSemanticSourceSnapshot` owner. A single contained descriptor capture
checks exact bytes and reconstructs the full canonical source manifest before
decoding is used. This replaces separate verify/reopen reads. Current worktree
bytes, missing/corrupt retained storage and caller metadata cannot substitute for
that pinned snapshot. Binary source owners retain their separate byte contract.

The package.json facet parses only supplied source bytes. Scripts remain inert,
package versions remain declarations, and navigation uses an honest full-manifest
source span plus JSON pointer. No build/test execution or measured coverage is
inferred. No external source retrieval or generated summary is introduced.

Remaining work includes canonical public contracts/transports, real scoped search
orchestration, provider-evidence admission, shared hydration/cache
invalidation, usage/external-version facets, actual token rendering and measured
facet comparisons. Regression fixtures are written but not executed.
