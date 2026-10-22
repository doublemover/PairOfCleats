# Whole-application storage ownership

Implementation status: source authored, **UNVALIDATED**. Runtime, Windows/UNC,
locked-file, disk-full, interruption and representative-tool acceptance remain
deferred. This contract introduces foundations for issues #1264–#1268; it does
not claim that every existing writer has adopted layout version 2.

`src/shared/storage/layout.js` resolves one application home and category
descriptors without filesystem access. Launch home precedes `PAIROFCLEATS_HOME`,
then the existing platform default: `%LOCALAPPDATA%/PairOfCleats` on Windows,
`$XDG_CACHE_HOME/pairofcleats` or `~/.cache/pairofcleats` otherwise. An absent
Windows LOCALAPPDATA retains the home-directory fallback. Category launch
selection precedes category environment, explicitly supplied trusted machine
configuration, then the layout default. Relative launch/environment values use
the captured launch directory; machine values use the explicit config file's
directory. Machine configuration must be selected outside repository authority
through `config-authority.js`; the pure resolver never loads project config.

Layout version 2 has `config/`, `state/`, `assets/{models,dictionaries,extensions,
tooling}`, `cache/{repos,shared,cas}`, `logs/`, `reports/`, `tmp/`, and `recovery/`.
The descriptor reports lexical/resolved paths, selected source, shadowed
sources, scope, owner identity, retention, rebuildability and external status.
It reports physical identity as uninspected until inventory is requested.
Resolving a descriptor never grants deletion authority.

`PAIROFCLEATS_CACHE_ROOT` retains its existing base-to-`cache` normalization;
trusted `cache.root` retains its existing effective-cache meaning. Both are
cache-only compatibility aliases, with an explicit diagnostic. Neither moves
models, tools or saved evidence. A path already ending in `cache` does not gain
another `cache` child. Existing readers continue to use their current paths
until their category owner adopts a verified locator; the new operator view
must report these legacy locations separately rather than silently relocating
them. `getRepoId()` remains the canonical repository identity; display names
are never used to merge repositories, worktrees or moves.

`catalog.js` records adoption seams and deliberate external exceptions, including
project config/rules, editor-host databases, explicit exports and global package
caches. Legacy triage, snapshot and diff registries remain saved evidence even
when found under a cache parent. Embedding inventory must protect
`cache.index.delta` as well as checkpoint metadata and use the embedding owner's
strict index reader to include deltas and immutable references; a failed reader
blocks destructive planning. Do not infer reachability from checkpoint JSON.

`inspectStorageInventory()` walks only explicitly registered roots. Entry/time
budgets and cancellation bound both enumeration and pending work. It rejects
links/junction traversal, records inaccessible and missing roots separately,
deduplicates observed physical files by device/inode across overlapping roots,
and leaves allocated/reclaimable/deleted-but-open space unknown when the
platform cannot establish it. Per-root logical attribution remains separate.
No stat failure is proof of zero usage, and incomplete scans cannot authorize
cleanup or migration. Last use remains unknown until supplied by the category
owner; filesystem mtime is not represented as access provenance.

`access.js` composes the existing repository admission/exclusion handshake for
adopted assets. Read-only lease inspection never reaps stale owners. Live,
foreign, unreadable and PID-reused owners stay protected. The adapter's coverage
is explicit: an unadopted model session, download or installer is not protected
merely because a descriptor exists. Such categories stay report-only until
their existing owner supplies complete lease/reference evidence.

Durable repo-ID state resolves through `storage/state.js` to
`<home>/state/repos/<canonicalRepoId>`, independently of cache-only overrides.
Viewer preferences can use `maps/viewer-preferences.json` below that root. The
repo ID must come from the authenticated repository owner, not a display name
or a saved artifact's `model.root`. Managed installation receipts at
`<toolingRoot>/install-receipts/<toolId>/<identity>.json` are evidence and remain
protected even though adjacent package downloads may be rebuildable.

Scan deadlines are checked between filesystem operations. A pending operating
system operation, including offline-share I/O, is not asserted to be preemptible.
Windows Node stat does not establish allocated compressed/sparse bytes; those
remain unknown. Root metadata-only inspection never presents registered paths
as measured bytes. Physical identity and allocation are separate unknowns.

The existing repo-access protocol now accepts an optional absolute
`coordinationRoot`. Adopters must select the same owner location for every
reader/writer/collector of an asset; it is not safe to mix default and custom
coordination namespaces. Existing repository callers retain their existing
default unchanged. Whole-app migration requires an explicit owned state
coordination root, avoiding shallow legacy paths writing lease state outside
the application home.

`prepareRepoCacheAccessHandoff()` suspends new local admissions and asks the
reader owner to drain this exact lease. Its process-local token can be consumed
once by `withExclusiveRepoCacheCleanup()` after exclusion is acquired. The old
reader lease is removed only under exclusion and restored before unlocking,
including ordinary failures. An unused token can be cancelled. A restoration
failure retains exclusion and requires recovery; it cannot silently drop reader
protection. This is an in-process handoff. It does not admit a child through a
parent's exclusive lease or establish a native subprocess transfer.

The `storage` command family uses one structured owner API:

```text
pairofcleats storage list --json
pairofcleats storage explain --json
pairofcleats storage inspect --exact --max-entries 100000 --json
pairofcleats storage doctor --json
pairofcleats storage configure-plan --category models --path D:\PoC\models --machine-config C:\Users\me\poc-storage.json --json
pairofcleats storage cleanup-plan --cache-root C:\Users\me\AppData\Local\PairOfCleats\cache --json
pairofcleats storage cleanup-apply --cache-root C:\Users\me\AppData\Local\PairOfCleats\cache --plan C:\Users\me\cleanup.json --plan-id <reviewed-id> --json
```

Only one supported action and declared options are admitted. Home-level
explain/doctor remain available when repository configuration is broken; the
failure is included explicitly and grants no cleanup/migration authority.
Configure currently produces an exact machine-local intent/diff, preserves
portable project config, and declares destination writability untested. A
writable destination probe, configuration apply and quota/TTL schema adoption
remain separate required work. No command changes data during explain,
inventory, doctor, configure-plan, cleanup-plan or migration-plan/status.

`clear-cache` now defaults to the same disposable-category plan. `--force`
cannot bypass its exact reviewed plan, ownership markers, file identities,
leases or category validity. The legacy synchronous whole-root deletion API
fails with `ERR_STORAGE_CLEANUP_PLAN_REQUIRED`, because cache parents contain
triage/snapshots/diffs and active builds. The first apply adapter covers only
ordinary singly linked, producer-marked command-probe JSON files under the
registered `tooling/command-probes` namespace. It reuses the existing contained
file reader, `assertSafeCacheDeletion`, repo-access exclusion and command-probe
file-removal owner. All other data is preserved. Preview pins authority-root
device/inode/mode and marker digest; apply revalidates them and file content
immediately before invoking that owner. Per-file outcomes distinguish deleted,
skipped and failed. Unlink-confirmed logical bytes and estimated allocations
are separate from actual free-space measurement, which remains unknown.

`policy.js` composes complete category-owner decisions: durable evidence,
forensic/pinned objects, incomplete references, external assets, unknown/live
leases and offline-critical downloads are protected. Unique physical allocation
is distinct from logical attribution. Shared aliases inherit every member's
protection; unknown links cannot promise reclaimable bytes. Soft/hard budget,
reserve and retain-count planning returns unsatisfiable/unknown admission with
an actionable space requirement, and never recursively deletes to meet a quota.
Category/repo scope is supplied by the existing owner; application-wide automatic
eviction and bounded last-use metadata adoption are not established by this
pure planning API.

`migration-plan.js` and `migration.js` provide bounded manifest planning and a
resumable copy/verify/publish/select transaction for explicitly qualified category
owners. The category adapter must affirm complete quiescence, portable
references/identities and compatible permissions, then verify the copied asset
at its consumer boundary. A separate explicit owner checks destination free
space and reserve. Generic migration rejects cache/repo/CAS/state/config trees;
their registry, generation, WAL and reachability owners must supply specialized
adapters. No runtime category is advertised as qualified merely because the
programmatic engine or descriptor exists, and CLI migration planning currently
reports the missing owner rather than offering a speculative apply command.

Plans pin source file identities, checksums, empty-directory inventory, selected
locator and authority roots. Cross-volume copies use streaming contained handles
into a target-volume sibling stage, fsync file data, verify the exact destination
inventory and category identity, then publish an immutable generation and
atomically select only the declared category locator. Opaque evidence is never
rewritten. Source is retained throughout, hardlinks become independent copies,
and logical copy space is stated independently of source allocated bytes.
Compact progress journals and the immutable plan live in owned recovery
storage. Resume verifies existing copied files; corrupt partial files are kept
under the run's failed-files recovery directory. Unknown stages are retained,
not adopted or deleted. Rollback verifies source and destination, refuses a
newer category selection, restores only the prior locator and retains both
copies. Source cleanup requires a separately reviewed category plan and grace
policy; no automatic unlink or promise of rollback after deletion exists.

Verified locators are read after explicit env/config overrides by existing
model, tooling, extension and dictionary path owners, and by cache/temp owners.
Legacy defaults remain unchanged until a cutover is selected. This adoption
does not establish real model-session/install/download quiescence, all-platform
permission preservation, consumer parity, or the WAL/UNC/junction/locked-file
acceptance matrix. Those runtime receipts remain required.

`child-environment.js` plans child-local secondary writes by exact tool/profile,
platform, architecture, project and run identity. Managed npm download caches
are separate from `--prefix`; Go module/build caches, NuGet/dotnet state, Ruby
spec/bundler caches, Composer, Gradle and selected Cargo/rustup routes are
declared explicitly. Global/user executables and inherited nondefault cache/temp
overrides remain external read-only inventory. The helper does not change HOME,
global user configuration, Go SDK selection, GEM_HOME/GEM_PATH, project lockfiles
or build outputs. Pip, arbitrary LSP workspace arguments and SDK-specific model
cacheDir routing require actual owner adapters; no unused family is represented
as a contained observed write. Transformers.js/ONNX explicit assets are not
adopted as a global Hugging Face cache.

Explicit `prepareManagedChildStorage()` creates only launch-authorized declared
locations and a run-owned scratch receipt; planning never creates them. It
preserves failed scratch and crash evidence for owner recovery. Installer and
runtime callers must adopt the returned environment and lifecycle lease before
their writes are covered. Observed fake-tool subprocess regression source is
authored, but no subprocess or representative real tool qualification has run.
BEAM defaults now select owned scratch instead of project cwd while preserving
an explicit ERL_CRASH_DUMP. Lua/package-patch same-volume staging, additional
installer families and all failure/platform acceptance still require their
existing owner integrations.

The scoped `storage/session.js` adapter now composes the existing reader protocol
for individual model/tool/download resources. It retains exact leases until the
owning resource supplies an explicit settlement receipt bound to its resource ID.
Unconfirmed teardown retains the session and primary error for later reconciliation;
a fulfilled action promise alone is not a disposition proof. It does not replace
process-lifetime repository reader defaults. `managed-child-session.js` holds
those leases across explicit scratch/cache preparation and child execution; its
caller must validate the real subprocess termination receipt. Runtime adoption
at the actual model/tool owner remains required and unvalidated.

`tools/storage/embedding-adapter.js` adds a read-only complete-identity profile
adapter. It calls `readCacheIndex(..., {strict:true})`, including delta replay,
and the existing immutable-reference protection owner. Metadata snapshots before
and after index/reference reads detect concurrent checkpoint/delta/lock changes;
any unreadable/partial reference authority blocks lifecycle admission. Inventory
protects JSON/bin checkpoints, `cache.index.delta`, mode metadata and lock files.
Only known mode/chunk directories are scanned: recursively treating the legacy
tuple parent as legacy bytes would accidentally count every nested profiles-v2
identity. No lock is acquired or recovered during inventory. The adapter grants
no generic cleanup/migration authority; shard pruning remains with the embedding
owner, and consumer/runtime/quota acceptance is still deferred.
### Reviewed configuration selection

`storage configure-plan --home <absolute-home> --category <category> --path <absolute-target>`
observes the actual compatibility location and target without creating either.
`configure-apply --plan <file> --plan-id <id> --home <same-home> --category <same-category> --path <same-target>`
requires that exact plan, unchanged locator and trusted configuration hashes,
and unchanged source/destination objects. It selects only adopted categories
(`cache`, `models`, `dictionaries`, `extensions`, `tooling`, `tmp`). A nonempty
source requires the migration owner; a nonempty different destination is never
implicitly adopted. No source bytes or category directories are removed or
created by configuration.

Preview separates `selectionDiff` from `effectiveDiff`. An existing explicit
launch, environment or effective-config category override retains precedence;
relocation through a shadowed locator is blocked with its actual caller source
and remedy. Updating that override belongs to its existing configuration owner.
Directory emptiness is checked with one bounded entry read, rather than an
unbounded listing of a potentially large category.

Configuration publishes a create-only, durable receipt under
`<home>/config/storage-selections/<plan-id>.json` and atomically selects it through
`storage-locations.json`. Consumers verify the receipt hash and exact home,
category, target and plan identity. Missing or changed receipts fail closed.
Migration, rollback and configuration share `config/storage-locator.lock`.
Explicit existing environment/project overrides still take precedence; callers
must restart to observe a new selection. These source contracts and authored
regressions remain **UNVALIDATED** until the deferred validation phase.

`selected-layout.js` applies the verified locator as a pure overlay of layout
intent. Existing explicit launch, environment and machine inputs retain
precedence and expose shadowed selections. Cache-child defaults follow the
selected effective cache root. The base `resolveStorageLayout()` stays free of
filesystem reads. Storage diagnostics and the actual managed-child planner
consume this overlay; managed preparation rechecks the exact locator snapshot
before creating any declared directories. An intervening configure/migration
selection requires a new child plan. Invalid machine-layout shapes remain
visible in home-level doctor/explain diagnostics without granting mutation
authority from fallback paths.

Rollback records `rollback-prepared` with its exact target locator before
switching selection, under the same migration operation lock used by forward
copy/resume. Interruption before the pointer keeps the selected copy usable;
interruption after it leaves an explicit pending rollback that can be settled
by verified resume. Pointer publication alone is not settlement. Forward resume
cannot overwrite pending rollback intent, and duplicate settled rollback makes
no further change. Both copies remain retained.

Resume and rollback bind the selected path and category owner as well as the
migration ID. Unknown journal fields, incompatible recovery records and unknown
staging/publication marker fields are preserved rather than adopted by failure
recording. Status requires the intact reviewed plan before resolving recovery
paths. Source-only fixtures cover these boundaries; platform, interruption and
runtime acceptance remain deferred.
