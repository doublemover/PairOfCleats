# Directory replacement resource and recovery boundaries

Status: UNVALIDATED source and authored controls. No runtime, native, physical-link,
cross-process, import-budget or performance acceptance was executed for this batch.

The shared directory replacement owner admits exact ordinary source, existing
target and immediate parent identities. It rejects overlapping roots. Existing
backup and promotion retry windows and the explicit `allowCopyFallback:false`
quota contract remain in force. The pre-promotion hook still receives the actual
candidate backup pathname before any old generation is moved.

Every native rejection captures its original resource observer before diagnostic
classification. Those original observations gate subsequent retries, fallback,
restore, parent durability and recursive cleanup, including after awaited metadata
lookups. Replacing an error's observer or a false/absent pending flag cannot erase
an original prerequisite. Nonvoid native acknowledgements remain unconfirmed.

The copy fallback exclusively creates a target-volume sibling directory before
copying into it. It never pre-cleans a guessed staging or rollback pathname.
Cleanup uses that admitted root identity and revalidates its original parent;
an unsealed or replaced root is retained. No arbitrary current generation is
moved away during restore: only an exact admitted new source/staging root may be
returned to its original absent location before the old backup is restored. A
foreign current directory and the sole old backup both survive a failed restore.

A successful native promotion is the commit boundary, recorded before subsequent
verification or parent-directory sync. Later durability or cleanup errors preserve
the committed target and its retained backup. Parent descriptors use the existing
contained-file owner; original stat/sync/close failures carry that same private
close-only capability through the directory error. Reconciliation closes only
the exact original descriptor and never replays promotion, copy or deletion.

Failure context preserves falsey/frozen primaries and independent recovery errors.
`recoveryPaths` lists retained candidates without claiming that every path was
successfully scanned or still exists; `directoryReplacementState` distinguishes
uncommitted, promotion-unconfirmed and committed outcomes. An ordinary extensible
primary remains the same error object when there is no independent error to
aggregate. Error resource observations are sealed before returning to consumers.

The authored actual-consumer fixture covers normal retained/removed backups,
exclusive cross-device fallback, disabled fallback, falsey/frozen failures,
pending native rename/copy, original-observer replacement, foreign current and
backup roots, post-commit failed parent close, lookup-time prerequisite changes
and overlapping inputs. Deterministic unsupported-directory-open positive controls
explicitly do not claim directory durability on Windows or POSIX. Existing
JSON-stream fixtures and producers remain under their separate owner.

Root identities do not freeze every child in a caller-owned directory, make a
portable atomic compare-and-rename/remove syscall, seal mutable external inputs,
or replace caller leases/journals. The visible-path gap while an old directory
is backed up remains an explicit fixed-path replacement limitation. Same-volume
sibling fallback names preserve locality; long paths, junction/ancestor swaps,
concurrent mutation and process interruption require the deferred qualification.
There is no new resource registry, migration authority, or automatic retry of a
failed native descriptor close.
