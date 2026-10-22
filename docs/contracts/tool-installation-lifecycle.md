# Tool installation ownership and lifetime

This describes authored source interfaces. The current implementation and
fixtures are **UNVALIDATED**; no installation, protocol handshake, platform
qualification or lifecycle acceptance is established by this document.

## Receipt strength

`tools/tooling/install-receipts.js` records an observed consumer, its physical
bytes, recipe identity and verification level. Observing an existing executable
does not adopt its installation directory or grant deletion authority. External
system/user/project tools retain their existing owner.

`tools/tooling/managed-install.js` separately owns installations created from a
canonical pinned descriptor: approved immutable HTTPS source, exact archive
size/SHA256, platform/architecture, contained layout and mandatory verifier.
It stores immutable generations and receipts below `toolingRoot/installs/<id>`.
`descriptorId` identifies the recipe; `installId` identifies the physical
generation. Repair of damaged bytes publishes a distinct generation with the
same descriptor identity and retains the damaged evidence.

The selected locator is published only after layout/byte verification and exact
verifier resource settlement. Live consumer leases prevent selection replacement
and removal. Failed updates retain the previous selection. A verified sibling
can be selected later without downloading it again. Removal acts on one intact,
selected, owned, idle generation; other generations and receipts remain.

## Allocation admission

Canonical recipes declare complete additional allocation bounds for every
destination, including archive/expanded artifacts, staging and package/build
caches. The internal declaration is:

```text
storageEstimate: {
  complete: true,
  writes: [{
    destination: "artifacts" | "scratch",  // or environmentKey, or absolute root
    requiredBytes: <inclusive additional allocation bound>,
    minimumFreeBytes: <optional nonnegative reserve>,
    hardBytes: <optional nonnegative logical-byte budget>
  }]
}
```

Each entry has exactly one destination selector. `environmentKey` binds to the
actual child-local environment location; an absolute `root` is explicit.
The installer binds these declarations to actual artifact and secondary write
paths and invokes shared storage admission with
`{writes:[{root,requiredBytes,minimumFreeBytes,hardBytes}]}`. Coverage cannot omit
the artifact root when secondary environment paths are overridden. Foreign or
incomplete destination authority defers writes through the storage owner.

An archive's compressed length alone does not bound extraction or transitive
package builds. Missing estimates defer before SDK/package acquisition and
directory preparation. Admission never cleans existing assets to fit. Existing
compatible selections can be reused without reacquiring an archive. The generic
archive and Go SDK publication boundaries also require admission before writing.
Current recipes without qualified complete bounds remain deferred.

## Actual resource settlement

`runToolInstallChild` uses the shared async subprocess owner and
`runManagedChildWithStorage` across preparation through actual child close or
the existing termination owner's scoped error receipt. The generic publication wrapper holds shared storage
sessions and destination reservations through its archive/staging/verifier work.
All use the existing state `storage-access` coordination namespace.

A managed verifier receives `resourceId` and must return an exact
`{resourceId,settled:true,pending:false}` settlement with its result. A verifier
throw without equivalent settlement retains stage/locks/leases and exposes
`managedInstallSession`. Pending storage sessions and write reservations remain
on the error; nested child-storage handles are retained separately. The primary
operation error survives cleanup failure. Release occurs only after the actual
resource owner confirms settlement.

The read-only `resolveManagedToolInstallation` locator verifies selected receipt
and consumer command bytes. It does not pin a runtime lifetime. Consumers must
hold `retainManagedToolInstallation` until their actual owned children settle.
The shared module exposes both async and sync retain APIs without importing the
tooling installer. Both inspect the complete selected physical generation and
take category/owner leases before admission. The sync API does not itself launch
or establish settlement of a sync child.
Structural runtime, actual tooling reports and install pre/post detection now
retain the exact physical installation before async version/help and work
children. Cancellation and unconfirmed closure preserve their exact error/session
handles. Installed bytes, executable/runtime checks,
protocol capability, model inference and project qualification remain distinct.

The legacy Go SDK owner retains its official-index/full-layout verification and
uses admission at its writer boundary. Its verifier is now async, propagates
cancellation and requires exact resource settlement before publication. Unknown
closure retains staging and destination reservations; the same actual child
callback controls later cleanup/release. Real SDK/consumer lifetime still
requires platform proof. Concrete portable
language descriptors, full package integrity closure and every operational
feature recipe are not implied by these generic interfaces.

The current shared subprocess boundary is direct-child close, with scoped
termination evidence on errors. It does not establish arbitrary detached
descendant/resource settlement after normal exit. A pending in-memory handle
alone also does not prove durable cross-process ownership after parent exit.
Those shared lifecycle gaps remain explicit; source adoption is UNVALIDATED.

## Secondary storage observations in receipts

Only the actual child's settled `action.storage` projection can populate
`secondaryStorage` version 1. It records `profileIdentity`, `runId`, declared
locations (`environmentKey`, `path`, `retention`, `external`, `source`, `purpose`,
`file`, `cleanupAuthority:false`) and bounded exception fields. Raw environment
objects and arbitrary extra properties are omitted. These are declared routes,
not observed child-write qualification, and never grant deletion authority.
Prior/external/missing/unconfirmed projections explicitly report
`unknown-or-not-recorded`. Inventory/cleanup owners must preserve that unknown
state rather than infer a cache footprint or ownership.

The producer and receipt readers share the managed child retention vocabulary.
File-valued BEAM `ERL_CRASH_DUMP` locations retain the protected `evidence` tier;
their placement under run-owned scratch does not grant cleanup authority.

Managed plans bind the actual absolute launch working directory. Relative
inherited cache/scratch overrides keep their environment syntax, while declared
locations and allocation reservations resolve against that child directory.
The installer refuses a changed launch directory before preparation. Ambiguous
Windows drive-relative overrides require an absolute selection; they are not
silently resolved against the installer's ambient drive directory.

Verifier success, verifier errors and reconciliation all require an explicit
`pending:false` alongside the exact resource ID and `settled:true`. Omitting
that field retains the transaction and its storage owners. The actual Go
subprocess adapter produces error settlement only from its no-spawn or existing
close/tree reconciliation evidence; an arbitrary verifier throw is unknown.
Retained sibling verifiers hold durable resource leases on their physical owner
and tooling category, so a dead initiating PID cannot make that sibling idle.

Managed descriptors, source records, file inventories and ownership receipts
use one registered persisted vocabulary. Unknown receipt/source retention fields
block consumer selection and lifecycle removal, even when known byte digests
still match. Recording an unknown `pinned` or forensic field cannot make that
evidence disposable. The actual async inventory hashes bounded files through
the shared contained-descriptor verifier, rather than reopening an unchecked
pathname after a metadata observation.

Lifecycle planning/apply, full byte inspection and actual installer acquisition
accept the same cancellation signal. A cancelled inspection closes its owned
file handle and propagates the cancellation instead of classifying the tool as
damaged. The lifecycle CLI owns `SIGINT`/`SIGTERM` through settlement and retains
their exit status. Removal checks cancellation before retirement; once the
selector/generation retirement starts, it finishes that admitted critical
section rather than stopping between its two renames.

The portable Go writer also pins the active receipt's bytes before acquisition.
It rechecks that digest and file object before activation, so an in-place edit
cannot be overwritten merely because the inode stayed the same. On conflict it
preserves the current receipt and verified unselected replacement and reports
both recovery paths without granting deletion authority. Permission or other
transaction-cleanup errors remain visible instead of being treated as absence.
