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

First-search apply checks an already-aborted signal before target re-planning
and marks that validation was not performed. Its pending execution handle needs
the actual child owner's closure predicate and an exact `pending:false` receipt;
duplicate settled release is idempotent. Plan identity includes the current
managed receipt, routing, allocation, locator and model acquisition contract
sources so those reviewed boundaries cannot change silently before apply.

Ordinary guided setup also uses the existing asynchronous child owner for
configuration validation, asset acquisition, tooling, restoration and build
steps. Its prompts and children share the CLI cancellation signal. Interruptions
stop subsequent steps, close readline, preserve `130`/`143`, and emit one blocked
JSON readiness summary with a separate cancelled or settlement-pending lifecycle
state. Unknown teardown errors are preserved and cannot become a normal optional
step failure followed by another acquisition or build. This source adoption and
its inert responsiveness regression remain UNVALIDATED.

Repository language discovery and tooling reports propagate that signal into
the actual owned detector. Cancelled discovery does not become an empty language
report, and a cancelled probe cannot start the next selected tool. The standalone
detection CLI keeps `130`/`143`, reports interrupted or unsettled readiness in
JSON, and completes its handler cleanup without an immediate success exit.

The existing Lua sibling publisher also preserves unknown or unreadable current
selection metadata before acquisition. It pins the exact current receipt bytes
and checks them again under publication, including after replacement staging.
Conflicts retain the prepared replacement and prior generation. Lua layout
results now require nonempty contained regular runtime files; constructing their
expected filenames alone is not availability or protocol readiness.

Fast target bootstrap uses the same asynchronous command owner for validation,
tooling detection/installation, dictionary acquisition, restore and build work.
It preserves terminal pending ownership instead of converting it into an
optional failure followed by a build. Streaming child progress is forwarded to
stderr without retaining the full output; tooling JSON alone is bounded and
captured. The bootstrap CLI handles cancellation through one terminal summary
and cleanup, and forwards the exact selected repository to restore/index/SQLite
children. The source and inert command regressions remain UNVALIDATED.

Bootstrap regression replacement keeps the old meaningful boundaries: a real
CLI smoke against a disposable target still requires one JSON stdout payload
and stderr logs, and a tiny actual Node child still streams more than one MiB
through the async adapter with an exact byte count and tail marker. The parent
retains only that marker suffix. The obsolete fake npm-in-target invocation is
replaced by explicit assertions that target dependency installation is omitted.
Inert owner tests separately cover pending teardown, cancellation and target
argument propagation. All these authored fixtures remain UNVALIDATED.

Installer HTTP downloads retain their actual response owner when cancellation
or reader-lock release fails, or a bounded teardown observation expires. Failed
cancellation keeps its locked reader for retry; Node response destruction waits
for actual stream `close`, and observed native close failure stays unknown.
The original failure and cleanup evidence are preserved, using an exact-cause
aggregate for frozen errors. Pending teardown disables automatic retry and
exposes `downloadSession`; its reconciliation returns an exact resource ID with
explicit `settled:true,pending:false` only after response ownership settles.

Managed archive transactions and portable Go SDK transactions require that
actual transport reconciliation before releasing staging, leases or allocation
reservations. A Go release-index failure before an inner transaction exists
retains the outer admission owner through `installDownloadSession`. Existing
primary pending-owner observers are composed with transport settlement, so an
earlier confirmation cannot release a different unknown owner. These source
changes and authored transport/native-stream/storage-owner fixtures remain
UNVALIDATED; no download or toolchain execution occurred during authoring.

Node response ownership observes native `close` immediately after acquisition,
independently of async-iterator EOF or `return().done`. Normal successful byte
consumption still waits for that actual close; an observed native close error
cannot become a successful download. On cancellation, the original iterator
teardown and native close are both retained through timeout reconciliation.
Neither one alone proves the other complete. Authored disposable-file controls
exercise delayed close, delayed iterator return and EOF followed by close error;
they remain UNVALIDATED.

Ordinary per-tool observation receipts publish exclusively from a flushed private
file. An existing identity is a no-op only after a bounded contained read checks
the same registered body; conflicting, unreadable or unknown evidence is retained.
The writer never renames over that existing record. Failure to clean its private
temporary file preserves the original publication error as an aggregate cause.
An incomplete temporary write is left as recovery evidence rather than removed
without confirmation that this writer completed its private write.

The actual receipt writer, lifecycle reader/verifier and secondary storage
inventory share checks for the registered observation fields, body digest,
consumer identity and secondary retention vocabulary. Unknown top-level, source
or location metadata stays unqualified and cannot select secondary scan paths.
Prior observations without secondary routing remain incomplete. Prerequisite
rows are bounded observations; these receipts still grant no removal authority.
The lifecycle inventory counts unregistered directory entries toward its bound.

A package-manager command or version-looking argument does not establish an
immutable upstream source or transitive integrity. New observation receipts set
`source.immutable:false`; a historical true flag does not elevate their existing
`not-probed` protocol or `not-qualified` consumer status. Canonical pinned archive
descriptors retain their separate existing integrity owner and are not treated
as ordinary command recipes. These publication, conflict and metadata controls
are authored source and fixtures only and remain UNVALIDATED.

Prerequisite executable identity now reads bounded bytes through the existing
contained-descriptor verifier after resolving the selected physical path.
Planning rechecks trust for that physical target. Synchronous and asynchronous
version probes execute that identified path and compare its original physical
path, digest and byte count before and after probing. Successful output cannot
bless bytes replaced during the probe, and a previous alias-shaped plan cannot
launch a newly redirected alias while hashing the old physical file.

The actual installer forwards cancellation into prerequisite planning as well
as asynchronous verification. Cancellation after a probe stops further probes
and qualification. These checks preserve existing bounded child ownership;
pre/post identification does not claim an atomic operating-system executable
launch guarantee for independently mutable external files. Authored inert-probe
and actual-file identity fixtures remain UNVALIDATED.

Owned detection uses the same physical path/digest/byte-count identity for its
actual bounded probes. Identity drift is terminal and retains its diagnostic;
it does not become an ordinary missing-tool result followed by another probe.
Managed generation retention still spans the real child owner. Frozen primary
failures and failed lease removal retain an exact `managedProbeSession`, with
the original error preserved as a cause when metadata cannot attach.

Probe reconciliation requires actual child/tree closure and every captured
independent pending observer before retrying the original installation lease.
That lease must explicitly return true; successful output alone cannot settle
failed removal. Exact metadata-only retry is allowed after confirmed child
closure, and repeated settled reconciliation is idempotent. Missing or throwing
independent observers stay unconfirmed. These actual-owner source changes and
inert-child/real-file/category-lease controls remain UNVALIDATED.

New managed archive transactions and removals also use the existing durable
storage session owner for category admission. Both retained-sibling and new-stage
native verification pin the physical installation owner through exact resource
settlement, then release that verifier before publication exclusion. A failed
verification admission adopts its actual partial metadata session when the
session producer identifies that release failure. No parent-path discovery or
alternate lease namespace is involved.

Transaction recovery retains frozen primary, journal and cleanup failures as
exact causes. It captures every original pending native/response observer before
attaching its own handle, and an explicit recipe receipt cannot override any
unknown or throwing observer. Its own exact session metadata errors remain
retryable without joining those independent blockers. Cleanup checks the actual
staging directory identity and reports unknown/unreadable evidence instead of
claiming it was removed. Metadata retries coalesce only original handles.

Removal preserves both generation-retirement and failed selector-rollback
errors, with retained selector/journal paths for explicit repair. Failed category
metadata removal exposes an exact `managedRemovalSession`; it does not retry
filesystem retirement or grant new removal authority. Authored actual small
archive/receipt/staging/category/removal fixtures with inert verifiers and injected
unlink/rename failures remain UNVALIDATED. No download, native tool, physical
link, real installation or user-cache mutation was performed during authoring.

Structural execution binds each identity probe and rule invocation to the same
identified physical path, digest and byte count, checking again after actual
child completion. Successful output cannot qualify changed executable bytes.
The execution scope retains every invocation it started until the shared child
owner confirms closure, including a callback that returns before its own rule
promise. A completed scope cannot start another child through a retained callback.

Frozen/readonly structural failures preserve their original cause, nested owner
capabilities and any failed release diagnostic. The exact
`structuralInstallationSession` composes original pending observers before
retrying its actual retained generation. Only that generation's producer-branded
metadata release failure is exempt from independent resource gates; matching
codes or session properties supply no authority. Missing/throwing observers stay
unconfirmed even with successful close flags. Authored inert-child/actual-file
and category-session controls, including injected unlink failure and exact retry,
remain UNVALIDATED.

Re-verifying the selected existing managed installation now retains its original
generation handle until both recipe resource settlement and exact metadata
removal succeed. A missing recipe receipt is not confirmation; reconciliation
requires that invocation's exact resource ID, settled:true and pending:false on
every call. Unknown receipt fields also prevent settlement. Existing native
pending observers remain independent, keep their original receiver, and cannot
be overridden by a contradictory recipe receipt. Frozen errors preserve their
exact cause and earlier nonenumerable capabilities.

Failed actual retained-session unlink exposes `managedInstallSession` for the
same metadata retry and keeps its outward failure pending until the original
handle explicitly confirms release. Only the actual session producer identity
permits this retry without self-blocking. The existing-generation path performs
zero downloads or publication. Authored actual strict-receipt/file/category
controls include frozen and nested primary failures, exact unlink failure and
retry, unsuccessful-but-settled verification, cancellation, contradictory
native markers and missing/throwing observers. They remain UNVALIDATED.
