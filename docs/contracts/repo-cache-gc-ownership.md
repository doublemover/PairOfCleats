# Legacy repository GC ownership

Windows focused qualification, 2026-11-05: four actual collector/CLI/MCP
regressions and 25 adjacent controls pass. The
[repair receipt](../archived/windows-cache-gc-resource-fence-2026-11-05.md)
preserves the four original failures and resulting source identities. All
mutation controls use disposable fixture caches.

Inactive process leases, old directory timestamps and a quota excess do not
prove that a whole repository cache is disposable. Repository cache roots also
hold snapshots, diffs, triage, logs/metrics, recovery, explicit pins and ordinary
unrecognized files. `storage/repo-protection.js` now supplies read-only admission
to the existing legacy repository collector before planning and again inside
its existing exclusive cleanup lease.

The guard requires the exact canonical `repos/<repoId>` root under launch-owned,
marked application cache storage. Its bounded contained inventory rejects
unreadable/nonordinary/incomplete state, changed directory membership and
physical alias inconsistencies. Saved-evidence namespaces are protected
regardless of the surrounding folder name or age. Unmarked application roots,
unknown files, unqualified empty directories, hardlinked files, malformed
producer records and explicit pin/forensic flags cannot acquire deletion
authority through `--force` or `--allow-unmarked-cache`.

Positive admission currently requires every file to carry its existing
registered generated-cache producer header and path contract (or the exact
two-field storage owner marker). The existing generated-artifact classifier and
contained descriptor reader validate those records. A complete proof pins the
root, directory objects, exact file identities and checksums. Full index/build
and mixed roots stay protected until their actual manifest/category owner
provides complete disposal proof; this change does not guess that all bytes
inside a named build directory are rebuildable.

Planning inspects both the legacy repository reader namespace and the
launch-selected `home/state/storage-access` resource namespace. Either a live
resource or an unreadable owner protects the repository without scanning its
changing contents. Apply uses the existing composed repository cleanup owner:
both exclusion namespaces remain held, and the selected cache/repos categories
stay leased against relocation until actual file work and metadata settle. A
modern reader admitted after planning therefore prevents deletion, and neither
legacy nor modern readers can enter the admitted removal transaction.

Apply reuses the existing generated-file removal owner.
It removes only the exact requalified generated files, then attempts `rmdir`
on exact empty directories. No recursive root removal remains in this legacy
path. A newly created ordinary file after revalidation makes empty-directory
removal fail and survives; a same-named replacement root cannot reuse the
previewed root identity. Failures preserve untouched files and report any
confirmed logical bytes already unlinked as a partial outcome.

Planning uses read-only lease inspection and does not recover stale owners.
Actual exclusive apply retains the existing ownership-safe stale-owner protocol.
Active-owner/unreadable byte accounting remains unknown rather than scanning a
changing tree and claiming zero protected bytes. Quota-only planning defers
when required accounting is incomplete; the result reports quota satisfaction
as unknown. A logical unlink count is separate from allocated or actually
reclaimed space, which is not inferred from the original root size.

The original arbitrary `data` fixture remains a protected negative after its
reader exits. The positive collector regression now uses the actual registered
Tree-sitter generated-cache metadata/path contract; its changed authority is
explicit. Additional source regressions preserve every saved-evidence class,
unknown and unreadable data, malformed metadata, incomplete scans, unmarked
container bytes, pins, late ordinary-file creation and replacement roots.
Custom native-store publication/deletion remains outside this generated-file
adapter; configured paths and caller labels do not grant deletion authority.
Broader platform and disk-full acceptance require their own receipts.
