# Storage inventory failure observation

Status: UNVALIDATED source and authored controls, 2026-10-22.

Registered-root classification, volume observation, ownership-marker reporting,
exact inventory and metadata-only layout inspection use the shared original
resource guard before returning failure records. A pending `ENOENT` cannot
become complete zero-byte accounting or an unmarked ownership report. The
classifier reads the original code once and rechecks its captured observation
after the asynchronous volume probe. A volume observation failure retains both
the original root failure and the independently pending volume owner.

Ordinary falsey failures produce the existing inaccessible, unavailable or
unreadable reports with typed fallback codes. Code/message and supplied volume
status inspection errors preserve exact original and secondary causes rather
than replacing them with a `TypeError`. The accounting rules remain unchanged:
only separately observed volume availability can qualify an ordinary missing
root, inaccessible/offline totals stay unknown, and marker reports grant no
deletion authority. Existing directory-session failures still propagate through
their original exact recovery path.

The authored `inventory-failure-observation` fixture uses actual disposable
root, file, marker, volume and inventory owners. Inert faults cover falsey stat
and marker-open failures; original observer markers, receiver and replacement
negatives; entry and final directory-stat failures; state changes during volume
inspection; independent volume work; and falsey supplied-status getters. It
retains positive bounded inventory, metadata-only inspection, marker and
unchanged-byte controls. Existing offline-accounting and directory recovery
fixtures remain in place. No executable checks have run for this source batch.

This change does not repair the lower contained-file/cache descriptor-close
lifetime, add native settlement authority, or turn a read-only observation into
a filesystem snapshot. Directory recovery continues to use its existing owner;
there is no new scan, parent discovery, cleanup namespace or cross-process
qualification. All native and platform acceptance remains deferred.
