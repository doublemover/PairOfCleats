# Native validation sessions — 2026-10-27

Source: `8e91fa316389f52a45f7bab6a597c737363dff1f`, tree
`d7557b2044ec27fec4b6703988d4396267f839bd`, on
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
Dependencies, patches and native binaries are unchanged; bootstrap was not rerun.

SQLite table validation, strict chunk-metadata parity and LMDB native reports now
hold launch-selected repository/resource/cache-category sessions before native
open. Their existing physical close owners remain authoritative. Native SQLite
closure and LMDB's original result plus completion callback precede release.
Real outstanding LMDB prefetch retains every lease through its callback handoff.

Original independent query observations remain required after physical closure;
replacing a reporting callback cannot settle them. Metadata failure retains exact
recovery owners, and explicit metadata reconciliation cannot repeat confirmed
native close. Controlled native-close exceptions stay unknown and protected.
Missing LMDB diagnostics release only an admission that opened no native handle.

**32/32 final affected Windows cases and the full front gate, including 40/40
gate cases, pass.** One job/thread, 30-second bounds, zero retries/native redo;
no failures, skips, timeouts, native crashes or unexpected warnings. Actual native
controls cover normal reads, category exclusion, late close replacement, exact
frozen causes, independent pending work and metadata recovery for all three
validation paths. Selected/current/mixed native generation, strict capture/order,
zero-state and finding-classification contracts remain passing.

The initial 27-case run/front gate preceded discovery of the separate strict
parity handle. That owner and five actual native cases were added, then the final
32-case cohort and complete front gate reran. Earlier observations are not used
to claim final-source acceptance. Five child-only historical-reader controls
from `621c8f7b6` fail before repair, including missing sessions, category admission
and held native prefetch. Checkout source was never reverted. The
[structured receipt](native-validator-sessions-2026-10-27.json) enumerates all
cases, controls, exact source identity and boundaries.

**#1574 remains partial:** custom/external registration, complete SQLite builder,
sidecar and unadopted legacy/other-backend lifetimes, eligible category-specific
deletion and all/multi-repo CLI/MCP qualification remain. These leases grant no
deletion authority. No user cache cleanup, GUI, WSL, elevation, physical links,
public knobs or security settings changed. Negative native-close controls manually
close their actual test handles but retain unconfirmed protocol metadata. Historical
`.tmp/tasks/native-validator-sessions-20261027/` and `.testLogs/` receipts are absent
from clean checkouts. Full deep, optional/model/performance, release and other
platform acceptance remain separate; the recorded queue remains 718 open.
