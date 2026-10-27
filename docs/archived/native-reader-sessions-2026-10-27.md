# Canonical native reader sessions — 2026-10-27

Behavior source: `eea652a771f5900a3389d997c80600f8b70b30a7`, tree
`c46c5df1784a89e7870128472584a1db9b43cbf8`. EOF-only repair:
`7d278bec689f1a7882456af5ea59e504973b775a`, tree
`43fefafe79d9f8af2bfd69b677b8ed7f573fe66b`. Branch:
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
Final diagnostic source: `b22a42ca52982fbee424f88a2a1491fb57f43cf5`, tree
`35aee8487d5f342299848ceaca136b4d73bc924f`.
Dependencies, native binaries and patches are unchanged; bootstrap was not rerun.

## Delivered

Canonical SQLite and LMDB retrieval readers now use the launch-selected repository
storage session already used by index writers. Repository, native resource and
cache/repository category leases precede native access and remain until original
closure. A held category exclusion rejects native initialization. Shared selection
retains locator revalidation, explicit effective cache authority and Windows path
identity; filesystem parents grant no additional authority.

SQLite captures its physical close owner before schema/ANN initialization. The
built-in cache takes that exact owner and changes its reference gate, preserving
the original method through late replacement. Another physical owner cannot be
created for the same handle, including after failed capture. Cached requests keep
storage leases after request disposal. Warm requests reuse one lease/hook set per
native object and launch namespace, with a 64-namespace bound; another namespace
joins the same physical settlement. Failed owners cannot be borrowed as healthy.

Actual native closure precedes metadata release. Failed native observations remain
captured; replacing reporting callbacks cannot settle them. Explicit recovery uses
the original resource owners. Metadata-only recovery follows known native closure
and never calls close again. Independent namespace release still runs if a sibling
metadata release fails. LMDB retains its original completion-callback requirement
while keeping durable storage leases through outstanding real prefetch.

## Qualification

**37/37 affected Windows cases pass at `eea652a77`**. All **9 cases affected by
the final diagnostic follow-up pass at `b22a42ca5`**, as does the complete front
gate, including **40/40 gate cases**. One job/thread, 30-second fixture bounds, zero retries/native
redo; no skips, timeouts, native crashes or unexpected warnings. Format, config
budget, environment audit, generated freshness, command surface and workflow pass.
The [structured receipt](native-reader-sessions-2026-10-27.json) lists every case.

The later staged diff check caught an extra EOF blank line in the new shared
selection helper, which the earlier working-tree check did not include while the
file was untracked. That failed staged check was missed before the behavior commit
was pushed. The separate whitespace repair above passes format and staged/working
diff checks. No additional native run is claimed for that behavior-neutral change.

Final review also caught enumerable recovery handles in the new diagnostic paths.
They are now opaque, non-enumerable capabilities; the original owners remain
available internally. Both serialization controls fail against `7d278bec6` and
pass after repair, bringing the controlled before cases to six.

Four child-only prior-reader controls fail against `0cf811236`: missing SQLite
resource/category leases, cached SQLite capturing a late replacement close,
native initialization during category exclusion, and missing LMDB resource leases.
Actual installed SQLite/LMDB handles are used. The LMDB prefetch itself runs
normally; only its callback handoff is held at a deterministic boundary. Checkout
source was never reverted and no crash-status retries or backend disabling were
used. Existing failure, cache, cleanup and generation-selection controls remain.

New cases cover cached/uncached handles, 32 warm reuses with exactly one lease set,
two launch homes, invalid cached launch context, native-observer replacement,
open/format failures, category exclusion, independent metadata release and explicit
recovery. Existing index-writer category/session behavior uses the extracted shared
owner and remains passing. No physical links, GUI, WSL, elevation or security-setting
changes were used.

## Remaining scope

**#1574 remains open.** Custom/external backend root registration still needs
producer/publication identity and launch authority. Validator/probe/builder/sidecar
and unadopted legacy-adapter lifetimes, category-specific eligible backend deletion
and all/multi-repo CLI/MCP qualification remain. External roots remain protected;
these leases grant no deletion permission. Full deep-suite, optional sqlite-vec,
real-model, measured-performance, release and other-platform acceptance are separate.

The queue remains **718 open**: 459 qualification pending, 146 partial/follow-up and
113 unresolved implementation entries. Raw `.tmp/tasks/native-reader-sessions-20261027/`
and `.testLogs/` paths are historical author-workspace evidence, absent from clean
checkouts. No actual user cache cleanup or index restart was performed by this batch.
