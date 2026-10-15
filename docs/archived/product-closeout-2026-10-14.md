# Product closeout, 2026-10-14

Canonical status: [roadmap](../roadmap.md). Starting head:
`0efc59edce878c9c5fdb3e23a6bddf0c2ecee41c`. Host: Windows x64, Node 26.8.1.
The user authorized ten priorities and deferred further embedding work and broad
cross-platform CI campaigns. This is scoped local product qualification, not a
claim that every release surface or platform is accepted.

## Publication and integration

The prior six-commit batch was pushed and read back at the exact starting SHA
on PR #558. Integration remains main <- #556 <- #557 <- #558. No merge is
part of this closeout. The twelve dependency PRs #559-570 are superseded by the
combined dependency commit `dae8ecd62` in #558 and were closed with states read back. This is tracking
consolidation, not evidence that main already contains those versions.

## Startup and cleanup repairs

Search loaded indexing, language analysis, Svelte, ESLint and 802 Linguist modules
through broad integration exports. The CLI now imports the search owner directly;
federation imports its search owner directly and loads only when requested.
The search-plan import graph fell from 3,756 modules to 742. The existing full
wrapper test now passes all four fresh-process pages within its five-second
per-child limit (9.01s total on final focused rerun). No timeout was raised.

Artifact and analysis schema validators now compile when first used, preserving
a cloned declaration, cached compiled validator and per-call validation errors.
Default compilation remains eager for other callers. A focused regression proves
that missing required fields still fail, success clears errors, and declaration
mutation cannot weaken deferred validation. This also removes unused compilation
work from index startup; schema acceptance is still enforced.

The historical Windows failure was an EBUSY removing the cold fixture repository
after a 15-second build timeout (hosted run 37428326764 at `29398b4a`). Its helper
only killed the direct child. The current shared helper already includes owned
descendant cleanup. A new regression recreates the same real two-file cold build,
traces actual wrapper/index/native/grammar descendants and requires them to exit
before immediate removal. The accepted runner result was 14.2s with the original
15-second child limit. Initial 20-second and 15-second diagnostic attempts timed
out; both removed the directory with no surviving traced children. A later
instrumented diagnostic completed at 14.9s; it is historical, not the final
runner acceptance. Primary and cleanup errors are aggregated separately so
cleanup cannot mask a build failure. These results close the bounded scenario;
they do not retroactively reproduce the exact October 6 machine state.

## Product qualification

38 unique focused cases pass across the following selected surfaces:

- Retrieval: golden intent corpus; literal/phrase eligibility through real memory
  and SQLite paths; Boolean inventory semantics; ANN candidate policy; deterministic
  top-k ordering; multi-repo federation and generation invalidation.
- Snapshot lifecycle: freeze/history/as-of search, retention and active request
  leases. One fixture needed the canonical artifact version and a task-owned
  test cache; production format validation was retained.
- Cancellation: sync timeout child trees, tracked shutdown, Stage1 terminalization
  and inflight drain, and LSP subprocess cleanup.
- Indexing: ordered appender, byte hysteresis, scheduler IO backpressure and
  compression transfer. [Durable measurement](indexing-measurement-2026-10-14.json)
  records the real 51-file/58-chunk Stage1 build: 2,588ms measured pipeline total,
  1,070ms processing and 789ms writing. Postings high water was 531,634 bytes,
  8 rows and one pending item; 51 memory-pressure events, no queue timeout,
  oversize entry or capacity bypass. The fixture intentionally sets a tiny heap
  fraction to exercise pressure handling. This is not production capacity sizing.
- Incremental: three actual Stage2 builds compare edits/deletions/renames with a
  fresh index of the resulting source, including chunk identity fields and tokens;
  SQLite update/search and interrupted multi-worker recovery also pass.
- Tooling: the actual TypeScript compiler/provider resolves multi-file imports,
  conditional package types and symbolic results. Pyright fixtures exercise
  workspace boundaries and planning; they are not a new installed-Pyright or
  ecosystem-wide acceptance claim.
- TUI: real supervised searches, invalid-cursor failure, successful recovery,
  repeated lifecycle, cancellation, snapshot recovery and clean shutdown. Native
  Rust frame captures pass with the pinned 1.88.0 toolchain. No physical-terminal
  hardware or other-platform claim is made.

The initial frame test failed because Cargo was not on PATH. The existing Rust
installation was used to install the pinned 1.88.0 toolchain; `cargo +1.88.0 build
--locked --manifest-path crates/pairofcleats-tui/Cargo.toml --bin pairofcleats-tui`
completed, then frame capture passed in 2.50s. Shell-only PATH and RUSTUP_TOOLCHAIN
changes selected it; the default toolchain was not changed. The first new
supervisor recovery case incorrectly expected an unknown backend to fail; backend
fallback is supported, so the fixture now uses a genuinely invalid cursor.

Historical author-workspace logs (not promised in clean checkouts):

- `.testLogs/run-1792030339745-5xnood`: partial startup repair still failed 5s.
- `.testLogs/run-1792030377480-1mqqgt`: startup repaired, pass.
- `.testLogs/run-1792030423479-na7xp0`: retrieval/snapshots, 9 pass/1 fixture failure.
- `.testLogs/run-1792030473733-1vcrec`: corrected generation fixture, pass.
- `.testLogs/run-1792030515708-qs8na2`: initial cold setup timeout; cleanup separate.
- `.testLogs/run-1792030840793-oisqvv`: seven schema/cancellation/cold checks pass.
- `.testLogs/run-1792030894910-rirvia`: nine indexing/SQLite checks pass.
- `.testLogs/run-1792030962912-609lsm`: eight project/TUI pass, missing Cargo failure.
- `.testLogs/run-1792031083088-bie395`: initial recovery fixture expectation failure.
- `.testLogs/run-1792031122032-w80f03`: real supervised recovery passes.
- `.testLogs/run-1792031145406-l9kanr`: native frame capture passes.
- `.testLogs/run-1792031177120-bqlm8z`: final startup and release registry pass.

All runner invocations use repeated `--match` selectors, `--lane all --jobs 1
--timeout-ms 30000 --retries 0 --native-status-redo=false`. The nonexistent inherited
trusted-config override was removed only from test command environments. The
initial failures remain recorded; no skip, retry or enlarged deadline is counted
as acceptance.

## Scoped release candidate

Shipped-surface metadata advertised Node 24 despite the package requiring Node 26.
It now derives the same documented range, with a registry/package agreement
regression and regenerated release-surface guide. The real scoped release check
passed with `--surfaces cli --phases changelog,boot --runtime-target windows-node26`.
This validates current changelog and actual CLI boot, not unselected release
phases. Product/index/search checks above supply their separate bounded evidence.

A source candidate, exact commit and SHA-256 manifest are prepared under the
historical author-workspace directory `temp/tasks/product-closeout-20261014`.
The candidate requires normal bootstrap after extraction. It is not an npm
publication, installed binary distribution, GitHub release, merge, or broad
platform qualification. Further embedding work and cross-platform CI remain
deferred by user direction.

## Final publish gate

The ready-to-publish code passed `npm run format`, `npm run config:budget`,
`npm run env:check`, generated-surface freshness, command-surface audit,
workflow contracts and all 39 gate cases (23.3s; zero failed, timed out or skipped).
Gate receipt: `.testLogs/run-1792031489956-goefa9` (historical author-workspace).
The first freshness check caught a mismatched roadmap audit/reconciliation date;
the date was corrected and freshness passed without weakening its contract.
`git diff --check` also passed. Documentation link and roadmap contract checks
are run after the final receipt update. Hosted CI is not claimed as final-head
acceptance; broad cross-platform campaigns remain deferred.