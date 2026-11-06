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
claim is introduced here. Node's Windows stat still leaves sparse/compressed
allocated bytes unknown; logical bytes are not substituted for that measurement.

Five authored, locally unrun regressions cover invalid clocks/ages, epoch/tie/
alias ordering, exact blocked reasons, conflicting/unknown allocation and
same-volume reserves. Existing evidence-preservation controls remain. This is
part of #1267; cross-category/operator composition, producer-qualified allocation
domains and real Windows pressure/convergence acceptance remain required.
