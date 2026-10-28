# Benchmark evidence retention implementation — 2026-10-28

**UNVALIDATED source:** `a073483b9668e58e5c52f9bc62d917814ca0c6e3`, tree
`8853c5b3efe644a2f8f2f166cac737cd0b76894b`, branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

The actual A/B and embedding bakeoff producers now share bounded evidence
admission and settlement. Existing storage reservations account for each family
namespace under a fixed 2 GiB logical-byte budget. Original file-lock sessions
span accepted work and close; PID death does not retire resource fences.
Final/export/checkpoint references irreversibly pin their source runs, including
paths copied outside the checkout. Unknown legacy data remains protected and
counts toward admission. Capacity exhaustion rejects new work.

Only complete, flat, unreferenced settlements older than seven days can retire.
Immutable records bind root/run identities and every known file's exact native
identity, SHA256 and extent. The shared hash owner now supplies SHA256 observations
with original descriptor closure. Collection uses the existing maintenance/run
locks, rechecks the complete member set and individual objects, unlinks only
admitted files and removes only an empty original directory. Copied records,
hard links, unknown children, changed content and incomplete scans protect data.

A/B raw bytes must still match parent-admitted report digests at settlement.
Bakeoff resume copies/final receipts use the run owner; latest checkpoint writes
retain their existing atomic owner and writer fence. Accepted original worker
observations survive both owners, including explicit settlement recovery.
Pre-launch A/B cancellation still produces its meaningful cancelled report.
Ordinary handled child failure can retain a useful failed report; unknown native
settlement is never converted to an ordinary status. Context cannot overwrite
A/B experiment identity. Public report/checkpoint identities remain unchanged.

Twenty-two `perf/bench/evidence-retirement/*` controls are authored, **unexecuted**:
old/recent/pinned/final/active runs; unknown legacy and nested children; changed
content, record identity and member sets; copied markers and shared physical
files; opaque/expired maintenance authority; unknown/active capacity; changed or
missing admitted bytes; pending original work and observer replacement; handled
failure, closed-owner admission and late-child survival. One additional exact
SHA observation control is authored. The eight existing bakeoff worker-lifetime
cases now explicitly recover the new original evidence owner before releasing
the parent checkpoint lock. Original A/B interleaving, sequential digest,
cancellation and checkpoint corruption/interruption/concurrency assertions remain.

Format/ESLint, ten JavaScript syntax checks, script inventory generation and
whitespace passed. Shared-module analysis found zero cycles; generated inventory
did not change. No functional fixture, child, model, native campaign or benchmark
ran. #1663 moves from partial source work to **qualification pending**; no issue
is closed. Current source classification: **481 pending / 144 partial / 93
unresolved** of 718 open issues. Functional failure/interruption/capacity/reference
qualification and meaningful serial measurements remain, followed by the required
publication gate. Source is local/unpublished. Wider #1574 cleanup integration
and #1267 native qualification remain separate.
