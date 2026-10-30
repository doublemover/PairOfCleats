# Read-only category inventory

This source and its regression fixtures are **UNVALIDATED**. No CLI,
embedding/profile scan, user-cache inspection or runtime acceptance was run.

`tools/storage/category-inventory.js:inspectStorageCategory()` is the common
structured entry used by the actual `storage inspect` command. It routes
complete command-probe producer identity, dictionary consumer/manifest bytes,
and the existing strict embedding index/reference reader. Known owner adapters
do not grant deletion or generic migration authority. Unknown/pinned/future
metadata fields and missing/incomplete/reference failures remain protected.

`storage inspect --category command-probes` uses the current compatibility probe
location; `--category dictionaries` uses the current dictionary location.
`--path <absolute-root>` explicitly selects read-only inspection scope. Ordinary
logical descriptor categories filter the shared root inventory. Registered roots
and scanned bytes remain separate, and active/unknown owners prevent an idle
category claim. Command-probe observations include a second lease read and
file-object checks; they explicitly are not a filesystem snapshot.

Embedding inspection requires the explicit cache root and a complete identity:

```text
storage inspect --category embedding-profiles --path <embedding-cache-root> --plan <profile-request.json> --json
```

The request contains `schemaVersion: 1`,
`kind: "embedding-storage-profile-request"`, `identity` from the existing full
embedding identity owner, and optional `repoId`. This is a read-only request,
not apply authority. The adapter calls `readCacheIndex(..., {strict:true})`,
including `cache.index.delta`, and existing immutable reference protection.
Legacy tuple data remains a read-only fallback tier; unrelated profiles are
never recursively treated as legacy files. Unsafe byte sums remain unknown.
No lock is created/recovered and no index is repaired by inspection.

Registered-root `ENOENT` is classified separately from an unavailable drive or
share. Before reporting an observed missing path as zero bytes, the shared owner
performs a read-only stat of the filesystem root. An unavailable root, unknown
transport, permission error or failed scan keeps accounting incomplete and
bytes unknown. Doctor reports those roots as inaccessible or offline. A separate
volume observation is not mount continuity, writable-space proof or mutation
authority; concurrent filesystem changes remain outside a snapshot guarantee.

`storage inspect --category managed-installations` reads existing install
receipts under the current tooling location. It validates the real receipt
identity and the canonical versioned `secondaryStorage` projection. Only
`settled-declared-not-observed` records expose declared locations; prior,
external, pending or mismatched resource settlement remains unknown. The
adapter does not run a consumer executable or promote a version probe to
protocol qualification.

Secondary bytes are scanned only within launch-selected registered roots, under
the shared bounded accounting owner. Receipt paths never become read/write,
migration or cleanup authority. Deliberate external overrides stay metadata
only with unknown bytes; saved/unknown receipts remain protected. Overlapping
secondary roots share unique physical accounting, separately from receipt
evidence accounting. Declared routing and a settled installation receipt do not
prove actual subprocess writes or universal runtime lease coverage.

The managed child producer, install receipt projection and inventory reader use
the same retention vocabulary. BEAM's file-valued `ERL_CRASH_DUMP` remains
`evidence` through that path, including when stored under run-owned scratch.
Accounting a crash dump does not authorize cleanup or migration of that file.

The dictionary downloader qualifies conditional reuse from a bounded contained
read of the current local file. A configured source checksum must match the
actual bytes, allowing the downloader's one appended final newline. A `304`
requires the same file identity and digest after the request; a stale manifest,
same-size corruption or replacement cannot satisfy it. Failed reuse preserves
the current local object and reports failure. Writer reconciliation records
release only after the shared storage owner's asynchronous release succeeds,
so a rejected release remains retryable.

Dictionary common/language word loading and signature reads share bounded file
work. One code-dictionary load uses a single reader pool across all language
scopes; adding languages cannot multiply simultaneously open native streams.
An admission failure stops new work and drains already-started reads through
actual stream close before rejecting, so no dictionary mutation or owned read
continues after the failed load returns.

Doctor reads the existing access protocol at each exact registered descriptor
and compatibility root, rather than only the model descriptor. Repository class
locations carry their exact repository access root from the existing path owner;
they share one diagnosis row. Root-local repository/command-probe coordination
and the actual fixed `<home>/state/storage-access` asset coordinator remain
distinct. A future state descriptor does not silently move that coordinator.
No parent discovery, PID census, lease recovery or metadata creation is used.

Metadata inspection honors entry/time/cancellation admission between registered
roots, retaining uninspected locations with unknown bytes. Lease diagnosis also
stops admitting roots on its bounds and exposes `leaseInspectionComplete`,
`leaseStopReason` and per-root `leaseInventory`. Each existing per-root owner
reader retains its own bounded lease-entry scan; diagnosis does not claim an
interruptible syscall or instantaneous filesystem snapshot. CAS-specific and
unadopted owner protocols remain outside this exact protocol coverage. These
source changes and authored read-only fixtures remain **UNVALIDATED**.

The bounded filesystem inventory, configuration directory preview and managed
package capture use the same actual directory-descriptor owner. It captures
the original `Dir.read` and `Dir.close` methods and receivers, stops read
admission when its callback finishes, and drains every admitted read before
closing. Read and close failures preserve exact frozen causes. An unconfirmed
close or independent original pending observation exposes the non-enumerable,
process-local `storageDirectorySession.releaseAfterClose()` capability. Its
exact resource receipt requires confirmed original close and every captured
observation; copied properties do not establish producer identity. A missing or
throwing native observer remains unknown even after descriptor close.

Inventory propagates that actual owner instead of returning ordinary incomplete
accounting and admitting another root. Configuration still drains all already
started independent observations and retains their exact failure graphs.
Managed generation inspection propagates pending directory ownership instead
of reporting repair-required. Actual managed installation recovery closes its
captured file owners, then directory owners, before removing staging or
releasing category metadata. Migration retains its existing exact source and
destination exclusions for these directory sessions as it does for transfer
sessions; only exact descriptor settlement followed by exact exclusion removal
completes recovery. These additions create no new lease namespace, parent
authority, filesystem mutation permission or generic cache/repos migration.

Authored, unrun regressions cover actual disposable directory handles, delayed
unawaited reads, captured method/receiver identity, dual frozen failures,
independent known/unknown observations, stopped root admission, actual managed
inspection, nested managed file/directory recovery plus metadata unlink faults,
and migration directory/exclusion recovery with a successful resume. The
configuration observation fixture retains its concurrent drain/lock checks and
finds the exact close failure through the additional owner aggregate.
