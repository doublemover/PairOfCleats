# Windows native workflow and SQLite cleanup follow-up

October 29, 2026; implementation `94634df48`, based on `7379054b8`. The adjacent
[receipt](windows-native-cleanup-followup-2026-10-29.json) retains original
failures, exact source identities, focused reports and publication checks.
Author-workspace `.tmp/` and `.testLogs/` paths are historical; embedded results
remain available without promising those local files in a clean checkout.

## Native workflow bounds

Hosted Windows at `516e29edf` passes 33 native terminal/workflow cases and times
out build/search at 30.1 seconds. Validate/search passes in 23.1 seconds and
snapshot creation in 22.5 seconds. The artifact uploader still selected the old
`native-index-*` prefix after the fixture moved to `ni-*`, losing its seed,
terminal and interaction evidence. It now selects the actual directory and
retains bounded phase, event, seed, screen, search and settlement receipts.

Windows build/search and workspace setup now overlap the independent console
observer startup with the same canonical partial seed build. The native binary
starts only after that seed completes. No operation, source input, backend,
positive/negative assertion or job/descendant/terminal check is removed. The
18-second native lifetime, 26-second capture and 30-second fixture bounds remain.
All three focused real-binary cases pass: build/search **19.2 s**, validate/search
**22.5 s**, workspace **21.6 s**. Recorded phase times distinguish setup, actual
native readiness, terminal exit and the positive published-source query. This
optimizes demonstrated wrapper overhead; final hosted acceptance remains open.

## Original SQLite work and independent namespaces

The existing ignored-child regression exposes an unhandled rejection: the
operation owner retains the accepted child promise, but its `async` entry point
creates a second rejected promise when forwarding it. The entry point now
returns that exact accepted promise; root work keeps its asynchronous owner and
invalid admission still returns a rejected promise. Both context-free and
explicitly inherited ignored children retain the exact frozen failure. Their
parent drains accepted work and releases leases only after original settlement.

Actual canonical and configured SQLite readers expose a second defect. Once
native close succeeds, a failed metadata release in one launch home prevents a
healthy sibling home from retiring. Storage metadata now has an independent
cleanup queue after the original native, cache-bookkeeping and ordinary
settlement prerequisites. Each sibling rechecks those captured prerequisites;
all returned work, original failures and independent observations remain required
for overall closure. Healthy sibling metadata releases, the failed owner stays
reachable, and explicit metadata recovery never repeats native close. Existing
native/promise/inspection/revocation and bookkeeping negatives remain intact.

Three finalizer fixtures explicitly select code mode, matching their sole code
source/output. They retain the wrong-source-mode rejection, exact finalizer
failure, real row readback and ignored-child drain assertions. The default
all-mode production contract is unchanged.

Focused checks retain 95 distinct passing cleanup/reader/command/writer controls,
including real SQLite/LMDB work, changed selection, sidecars, admission races,
metadata recovery, original observer failures and actual cleanup CLI/MCP
delegation. Original failing observations and subsequent focused rechecks remain
separate in the receipt. Those controls are added to ordered CI membership;
coverage previously present only in discovery now runs in the required lane.

## Remaining acceptance

#1574 stays partial. Configured paths and caller generation labels grant lifetime
coordination, not deletion authority. Producer/publication registration,
category-specific custom-backend deletion, remaining adapter adoption and complete
multi-repository CLI/MCP qualification remain. External/unknown data stays
protected. #1288 actual VS Code host acceptance also remains open.

All eight publication checks pass, including **40/40 gate fixtures**, with zero
failures, timeouts or skips. Runtime/test bytes remain unchanged through that
gate; normalized source matches the committed implementation. Exact source
identities and reports are retained in the receipt.
Hosted CI, historical intermittent indexing hangs, broader deep-suite failures
and release/model/performance qualification remain separate.
