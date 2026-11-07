# Storage quota planning

`src/shared/storage/policy.js` composes category-owner lifecycle observations.
It plans against unique physical identities; it neither scans a second inventory
nor deletes files. Actual mutation still requires the existing category owner,
original lease/reference/identity checks and reviewed apply operation. Complete
caller metadata is not a serialized deletion capability.

Durable evidence, references, pins, forensic retention, unknown ownership,
external/shared storage and active/unknown leases remain protected. Downloadable
assets need explicit asset-eviction selection; being redownloadable does not make
an offline model/tool disposable by default. Unknown retention labels fail closed.
Optional retention age requires an exact nonnegative clock/age and a valid
producer-provenance timestamp. Invalid clocks/ages throw before decisions.

The planner admits at most 100,000 category records. Allocation and identity must
be exact; unknown records remain explicit and cannot become zero-byte capacity.
Aliases share one allocation. Conflicting alias allocations make accounting
incomplete and the measured total unknown. Any protected alias blocks physical
eviction. All links must be accounted before a physical reclaim estimate;
unaccounted links and count-retained owners are included in blocked reasons.

Oldest-use ordering uses the newest known use across a physical owner's aliases.
Unix epoch zero is a valid timestamp. Missing use time conservatively orders at
the current clock; an age policy additionally protects missing provenance.
Equal-age ties use stable code-unit identity ordering rather than machine locale.
The count policy retains its requested newest eligible owners. Age/count/link
blockers stay visible when a budget cannot be satisfied.

## Free-space reserves

Global allocated-byte quotas and a filesystem's free-space reserve are separate
constraints. A positive reserve debt requires the original free-space observation
to name `freeSpaceScopeId`; each physical item's `allocationScopeId` must come
from its category owner's matching allocation domain, not a drive-name guess.
Missing domain/space observations defer admission. Contradictory alias domains
make accounting incomplete. Zero reserve requires no fabricated free-space probe.

Only matching-domain allocations credit `plannedReserveReclaimBytes`. Their
mandatory reserve work is selected first and also credits the global quota;
unrelated-drive caches are not evicted before that same work could satisfy both
constraints. Remaining global pressure uses oldest-use order. Known other-volume
items cannot satisfy this reserve; unknown object locations stay explicit and
defer unresolved reserve admission. The preview separates required/planned
reserve bytes, globally planned bytes and per-object reserve blockers.

`quotaSatisfied` describes the proposal. Even a sufficient proposal returns
`defer-reviewed-cleanup-required` until the original cleanup owner confirms
actual deletion and a fresh observation establishes available space. Protected
or insufficient allocations return `deny-space-needed`; incomplete accounting
returns `defer-accounting-required`. No forced evidence eviction, recursive
parent deletion, retry loop, quota-based lease release or physical reclamation
claim is introduced here. Supported Node/libuv supplies per-file kernel allocation
through `stat.blocks` on Windows as well as POSIX. Missing/invalid allocation
remains unknown; logical bytes never substitute for it.

## Kernel allocation accounting

Inventory and reviewed probe unlink estimates share one exact conversion from
512-byte kernel blocks. Zero is valid for resident, empty or fully sparse files;
negative, fractional, missing and unsafe values are unknown. BigInt multiplication
precedes the JSON-safe integer check, so neither large block counts nor byte sums
can round into admitted capacity. Overlapping aliases are counted once; conflicting
allocation observations invalidate their scan even when other identity fields
match. Existing link, lease, reference, retention and deletion checks remain.

The Windows exclusion was incorrect for the pinned Node26.13.0/libuv1.52.1:
its [Windows stat owner](https://github.com/nodejs/node/blob/v26.13.0/deps/uv/src/win/fs.c)
converts the kernel `AllocationSize` into `st_blocks`. Reusing that observation
adds no native binding, extra file opens, toolchain or elevated action. These are
file-allocation observations; shared filesystem extents, metadata-container
overhead and actual free-space recovery are separate measurements. An unlink
still reports `actualReclaimedBytes: null`.

Five authored, locally unrun cases cover exact conversion, real ordinary-file
accounting across overlapping roots, conflicting original observations, reviewed
producer-qualified probe cleanup, and actual Windows compression/POSIX sparse
allocation. The Windows control compresses one4MiB disposable owned file with the
system `compact.exe`; it requires the underlying filesystem feature and preserves
the existing five-second child/30-second fixture bounds. No symlink, security
change, machine-wide setting, path-based reclaim guess or skip substitutes for it.
Real Windows execution remains pending.

Five authored, locally unrun regressions cover invalid clocks/ages, epoch/tie/
alias ordering, exact blocked reasons, conflicting/unknown allocation and
same-volume reserves. Existing evidence-preservation controls remain. This is
part of #1267; broader category cleanup and real Windows pressure/convergence
acceptance remain required.

## Coordinated category and repository limits

The same planner accepts at most 1,024 strict internal `scopes`, each naming a
category or repository identity and optional soft/hard bytes, retention count
and age. The authoritative flat schema lives beside the current storage-policy
schema. Duplicate scopes, unknown fields and invalid bounds are rejected.
The same strict input is used by the reviewed machine-local lifecycle selection
described below.

One physical object is counted once globally and once in every applicable
scope. Logical category/repository attribution can overlap; these scoped totals
are not added into a second global footprint. A shared object is selected once,
and its removal credits every applicable constraint. Missing category or
repository attribution defers the entire proposal when those limits are selected;
an explicit `repoId: null` identifies shared storage rather than an unknown repo.
Conflicting allocation observations remain unknown in their scoped totals.

Every alias must satisfy the existing lifecycle owner. Any applicable age or
count retention protects the whole physical object, including aliases outside
that scope. The proposal reports count-retention scope identities. Pins, saved
evidence, original readers and incomplete references retain their original veto.

## Reviewed machine-local policy

`storage policy-plan --category lifecycle --plan policy.json` reviews a complete
`{ "enabled": true, "global": {}, "scopes": [] }` policy. `global` accepts
soft/hard allocated-byte limits, minimum free bytes, retention count and age;
`scopes` uses the strict category/repository schema above. Limits are exact
nonnegative integers; zero is literal. Duplicate scopes, unknown fields and
soft limits above hard limits are rejected. Observed usage/free space belongs to
the live inventory owner and cannot be supplied as persisted policy authority.

Save the returned plan and apply it through the existing `policy-apply` command,
with the exact category, home, repository context and plan ID. Publication uses
the original storage-policy lock, immutable selection receipt and atomic locator.
Both command-probe and lifecycle selections coexist in **policy format 2**.
Readers verify every selected receipt; obsolete format 1 is rejected and requires
explicit current-format regeneration. No old policy is overwritten on refusal.

The publication owner captures and freezes nested policy records before waiting
for the original lock. Semantic receipt equality ignores JSON key/scope order but
retains every exact limit. Raw locator hashes still reject a stale review.
Omitted programmatic patch fields retain current selections; supplied `global`
and `scopes` records replace those complete records. Disabled lifecycle policy
retains existing assets. Policy publication changes machine metadata only;
category cleanup requires its separate reviewed owner and current inventory.

Seven authored, locally unrun cases cover strict limits/scopes, actual reviewed
publication and fresh reads, coexistence, semantic equality, stale reviews,
mutation across lock acquisition, obsolete-format refusal and CLI selector
admission. Existing command-probe resource/failure fixtures use the same owner.

## Reviewed lifecycle cleanup

`storage cleanup-plan --category lifecycle` observes the selected policy and all
launch-selected category/compatibility roots, including unknown data in the
application home. One original bounded inventory supplies unique native physical
allocation and the existing command-probe planner. Overlapping roots share each
file's allocation; unknown physical identity/allocation cannot become zero usage.
The deepest registered category attributes each path. Repository attribution
requires its producer; an unadmitted repo identity defers repository-scoped quotas.

Only the original command-probe owner currently supplies unlink operations.
Every probe retains its full producer/key, exact file identity, single-link,
cache-root marker, authority snapshot and live-lease checks. Saved evidence,
offline assets, unknown home data, pins, unqualified categories and unknown
original resources retain their veto. Missing use observations cannot satisfy an
age policy. Minimum-free reserves use an actual native free-space observation and
the matching native device identity, separate from logical size and quota debt.

The returned plan contains only the quota-selected original probe operations.
Apply requires the same launch roots and selected policy, a fresh physical/quota
observation and the same exact operations. The existing cleanup owner revalidates
authority, resources and the same selected policy immediately before each unlink.
A policy change stops further admission while retaining actual completed deletes.
A final observation reports remaining debt;
additional eviction requires another reviewed plan. A satisfied zero-operation
plan converges without metadata writes. One invocation's time allowance bounds
inventory, qualification, policy, free space, apply and the final observation.
Actual reclaimed filesystem bytes remain unknown; unlink allocation estimates
and native free-space observations are reported separately.

Nine authored, locally unrun cases exercise real producer-created probe files,
overlap accounting, minimal cleanup and no-op convergence, original live readers,
changed policy/roots, pinned and saved data, unknown repo attribution, bounded and
cancelled scans, a policy change after the first real unlink, a native volume
reserve and the existing CLI review/apply path.
Broader category mutation and native pressure/performance qualification remain.

Selection pays same-volume reserve debt first, then category/repository debts,
then any remaining global debt. Mandatory local work therefore contributes to
the global target before unrelated global eviction. Each pass uses the same
oldest-use order; the plan is deterministic, not a minimum-byte/set-cover claim.
Newest alias use is computed once before sorting. Scope membership is indexed
from the bounded owner inventory; count policies consume the ordered membership
lists rather than rescanning all items per scope.

`scopePlans` separates each scope's measured allocation, required/planned reclaim,
projected remaining bytes and satisfaction. Admission requires all scopes and the
original global/reserve constraints. A proposed solution still needs reviewed
category cleanup followed by fresh observations. No planned bytes authorize a
write or count as actual reclaimed space. Six locally unrun controls retain an
independent physical-set accounting audit, aliases across scopes, ordering,
count/age protection, attribution failures, pinned evidence, reserve composition
and 8,192 items across 64 policies. Connecting these proposals to every category's
qualified cleanup owner and machine-local policy publication remains unfinished.

## Operator lifecycle review

`storage inspect` now attaches a lifecycle review to the same inventory; exact
inspection reuses its unique physical/logical totals and attributed root bytes.
Metadata-only usage remains unknown. `storage doctor` joins that inventory with
its existing registered owner observations, including the actual home-state
coordinator and legacy repository scopes. The native TUI's existing inspect/
doctor path receives the same projection. This adds no traversal, access touch,
free-space probe, lease acquisition or deletion operation.

The review associates roots with existing class-catalog intent and explains
durable/evidence retention, offline asset preservation, mixed/unknown category
ownership, external locations, original leases and unestablished references.
Root registration, a clear generic lease scan or a parent named cache cannot
grant cleanup eligibility. Reclaimable allocation and quota admission remain
unknown until the category's own inventory, producer and retention owner qualify
them. Existing category-specific inspect/cleanup plans retain their authority.

Review detail is bounded to 128 registered roots by default, with exact omitted
counts and separate root-coverage/inventory-completeness fields. It does not sum
overlapping category attribution into a false unique footprint. Three additional
locally unrun cases cover root intent and unknown measurements, actual overlapping
fixture inventory without mutation, original held-reader diagnosis, cancellation
and bounded review output. This projection does not invent category-qualified
allocation or deletion authority; operator cleanup integration remains unfinished.

## Reviewed repository cache subsets

Lifecycle cleanup plan version 2 adds the existing canonical repository cleanup
owner alongside command probes. Version 1 receipts require a fresh preview.
The launch-selected state coordinator travels with the plan; a custom state root
does not silently fall back to another home during repository exclusion.

The application inventory remains the sole physical accounting observation.
At most 128 canonical `cache/repos/<repoId>` candidates receive bounded category
qualification. Their original cleanup owner checks complete generated-file
producers, references, evidence namespaces, writer state and both lease scopes.
Its complete file set and every identity must match the application inventory.
Unknown, changed, mixed, pinned and actively used roots remain protected.
Qualification reads are explicit cleanup work, not another inventory on hits.

Repository scopes charge all canonically attributed files, including protected
files. Unknown attribution stays unknown. The existing `repos` category remains
the category identity. Reviewed subsets retain ownership markers, unselected
files and directories; they never recursively remove a repository or home.
Apply captures its selection before asynchronous work, reacquires the original
exclusions, and revalidates the full original proof and each selected file.
Policy, cancellation and the shared duration budget are checked before every
unlink. Failed or interrupted cleanup retains its completed file list and stops
new work while original exclusion/descriptor owners finish retirement.

Fresh observation follows apply. No additional eviction runs automatically,
and `actualReclaimedBytes` remains unknown. Six authored, locally unrun controls
cover minimal subset pruning/no-op convergence, original readers, mixed evidence
and pins, stale file sets, changed policy and cancellation between real unlinks.
Full indexes, embedding/CAS reachability, model/tool eviction and generalized
last-use integration still require their respective category owners.
