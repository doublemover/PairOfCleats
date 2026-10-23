# Reviewed storage CLI workflows

Source and regression fixtures are **UNVALIDATED**. This implementation wave
did not run the CLI, inspect user caches, apply cleanup, execute migration or
qualify Windows/UNC/locked-file/interruption behavior.

`tools/storage/cli.js:runStorageCli()` is the actual command owner and an
importable structured consumer. Importing it performs no command. Direct
invocation forwards cancellation to the existing bounded inventory, cleanup,
plan reader and migration owners and retains interruption exit status.

Each action accepts only selectors interpreted by its existing owner. A flag
from another action is rejected before configuration or storage work. Boolean
values accept `true` or `false`, including explicit false and last-value
normalization; arbitrary text is not a false policy selection. No new public
option is introduced.

Configuration and policy apply require the same reviewed repository context.
Configuration also compares its current compatibility location, winning source
and explicit machine configuration source with the reviewed plan before invoking
the canonical publisher. A newly selected environment override or different
project cannot reuse approval from another context. Canonical plan IDs,
locator hashes, directory identities and publication/recovery checks still
belong to the existing shared owners. CLI output never appends unsealed fields
to a reviewed plan.

Cleanup supports only the existing `command-probe-v1` adapter. An explicit
`--category` must be `command-probes`; an explicit `--path` must equal
`<selected-cache>/tooling/command-probes`. Other categories, nested paths and
ignored filters cannot broaden cleanup. If the application's current cache
differs from the launch-authorized layout cache, the operator must review and
select the exact existing `--cache-root` option. Repository context alone grants
no cleanup authority. Existing markers, immutable reviewed content, current
leases and the canonical file-removal owner remain required.

`list` and `explain --category <logical-category>` filter descriptors, compatible
locations and class rows. `inspect` and `doctor` filter logical-category roots
and lease diagnosis. Adapter categories (`command-probes`, `dictionaries`,
`managed-installations`, `embedding-profiles`) use their actual read-only owner;
an explicit diagnostic `--path` requires such an adapter. `--plan` on a diagnostic
action means the existing complete-identity embedding-profile request only.
Category doctor reports incomplete/protected ownership and invalid probe policy
without installations, repair, lock recovery or new migration authority.

Migration plan/apply/rollback preserve the selected category, absolute source,
absolute destination and application home. Status may omit category/source/
destination; if supplied, they must match the reviewed plan. Status cannot use
a different home to inspect or adopt another plan's journal. Machine migration
does not publish its locator or recovery state inside portable project context.
The existing dictionary adapter still requires an actual permission disposition
owner; a descriptor or readable directory cannot qualify ACL/xattr equivalence.
An unqualified migration plan is returned with `ready:false` and nonzero exit
status. This does not establish an executable, qualified migration workflow.

All apply actions, including rollback, return nonzero status for incomplete
outcomes. Blocked plans also return nonzero status while retaining their sealed
review data. Diagnosis can return incomplete accounting as data. A settled
failure after mutation admission reports `mutationPerformed:null`; it cannot
claim that an interrupted publication or migration changed no bytes.

Actual pending descriptor/resource observations propagate to process-local
callers with their original recovery capability and a diagnostic
`storageCliContext`. The direct CLI reports `settlement-pending`, preserves the
reviewed plan and recovery evidence, and offers no success or release proof.
Ordinary inaccessible/unreadable records remain protected incomplete evidence.
An absent or replaced callback, throwing diagnostic getter, or cancellation
does not settle the original native owner.

Category adapters use the shared failure-observation owner before projecting
errors. Embedding inspection stops admitting new metadata/physical work after
cancellation or its budget, leaving unperformed accounting unknown. Canonical
inventory and each category's own bounded reader retain their existing limits;
these are read-only observations rather than a filesystem snapshot or vendor
write-containment qualification.
