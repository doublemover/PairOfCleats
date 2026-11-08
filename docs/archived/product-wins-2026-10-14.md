# Selected product improvements — October 14, 2026

Status: selected implementation and bounded local qualification complete. Historical native crash remains unresolved.
Baseline: `a8c19738eb236032a56f2ac6d583b799508d5d67` on `codex/pr557-audit-repairs-20261012`.
Scope: user-selected items 3, 4, 6–20. Items 1, 2, 5, embeddings, and broad cross-platform CI remain excluded.

## Outcomes and limits

| Item | Result | Evidence / boundary |
| --- | --- | --- |
| 3 | Continuous events cannot indefinitely postpone watch work; internal maximum wait is max(1 second, four debounce intervals). | Production watch queue with real edits starts at 1,054 ms during a 30-edit stream and consumes the last edit. Build is stubbed: scheduling latency, not a full edit-to-search benchmark. Consistency/no-loss regressions pass. |
| 4 | Empty output explains query/filter, metadata and recorded fallback cases with next actions. | Human/JSON fixtures; no inference of stale indexes from empty results. |
| 6 | Windows native realpath reduces repeated ancestor traversal, retaining symlink and open-descriptor checks. | One identical-input cold-cache pair: 13,053 to 11,975 ms wall time (8.3%); processing 4,170 to 3,486 ms. 44 real files, 181,272 bytes, 55 chunks. [Input hashes and measurements](product-wins-2026-10-14.json). Not a general performance claim. |
| 7 | Status/report exposes generation-associated coverage/skips, recorded revision, live SCM revision comparison and saved watcher backlog. | Dirty/unverified trees and old-generation metrics remain distinct. No filesystem-content comparison; saved watcher receipts are not live observations. |
| 8 | Duplicate type facts cannot crowd distinct evidence out of context budgets. | Contract matrices and real-source context include definition/import-dependent test evidence. Byte/token caps bound the primary excerpt; graph/evidence caps are separate. |
| 9 | Real SDK discovery, search, context, invalid request, recovery and close work. | Six searches: 395–726 ms, about 14.3 KB each; context 1,344 ms/7.8 KB; malformed context 268 ms/325 bytes. Tiny real-built fixture, no mock transport. |
| 10 | Filter-only workspace enumeration traverses repository/mode pairs without ranking. | Real two-index exhaustion; cursor generation/filter rejection, anchored dates, empty pages, publication during reads. Unavailable modes are explicit partial coverage. MCP schema 1.7.0. |
| 11 | Empty impact warns that absence of recorded dependents is not proof of no impact. | Real copied `src/graph/ordering.js` and its importing contract test produce expected upstream impact. |
| 12 | Name fallback respects boundaries, avoiding `app` inside `mapping` or `happy`. | Boundary regression and graph-backed selection of the actual ordering contract test with witness/fidelity metadata. |
| 13 | Doctor provides reason-specific non-mutating recovery argv. | Missing commands/runtimes, workspace/configuration, disabled and healthy cases. Existing status hints handle missing index artifacts. |
| 14 | Bounded historical native teardown investigation completed. | Stage4 explicit-root/no-promotion fixture passes in 17.4 s. No matching accessible Windows Application event. Prior 0xC0000005 remains **not reproduced and not root-caused**, not claimed fixed. |
| 15 | Bounded real MCP session resource check completed. | Wrapper stays at 206 handles and 58.7 MB private memory. Actual Node server: 286 handles throughout, private memory 738.5 / 617.4 / 650.3 MB at calls 4/10/16 (GC fluctuation, not monotonically increasing). Two stable children, both exit with wrapper. No retained-process growth observed; server idle memory is still substantial. This is not a long soak or proof against every leak. |
| 16 | CAS preview reports scanned/reachable/leased/planned/deleted bytes; quota GC requires apply. | Lease exclusion, actual stat sizes, zero preview deleted/freed bytes and preserved legacy fixture. No user cache deleted; legacy whole-repo apply remains offline maintenance. |
| 17 | Installed Pyright resolves a relative package import and infers `int`. | Real provider exposed body parentheses fabricating parameters. Matching parameter parentheses fixes it; exact return/empty-parameter assertions and signature matrices pass. |
| 18 | Dynamic JS/TS calls no longer fabricate receiver/global call targets. | Actual dynamic calls through `tasks[message.name]`; Babel/TypeScript cases retain static targets. Call-flow/LSP producer identities and incremental signature version advance. |
| 19 | TUI restores selection, focus, filter/search state, follow mode and offsets. | Rust 1.88.0 regression passes; old snapshots retain defaults. Does not restore running jobs. |
| 20 | Local source candidate with locked bootstrap and baseline-to-candidate upgrade. | Isolated locked bootstrap, installed CLI search, preserved config/prior index and incremental rebuild pass on Windows/Node 26.8.1. Source candidate only; no registry publication, release tag or cross-platform qualification. |

## Validation provenance

All `.testLogs` and `temp/tasks/product-wins-20261014` paths are historical author-workspace receipts, not promised in clean checkouts. Registered tests use one job, a 30-second per-test deadline, zero retries and no native-status redo.

- `run-1792032335390-0g7kwl`: watcher consistency/debounce/no-loss and empty-result/human rendering, five passes.
- `run-1792032433095-ihurzu`: suggestion boundaries/fidelity and coverage/read-only diagnostics, four passes.
- `run-1792032459887-xccunf`: historical teardown fixture, one pass.
- `run-1792032688281-ra8ffh`: containment boundary/verified-read, two passes. Initial Windows fixtures needed a directory junction rather than privileged file symlink, and acceptance of OS-denied replacement of an open file. POSIX checks remain intact.
- `run-1792032997951-pbi2dl`: context dedup, impact and CAS GC, three passes.
- `run-1792033091551-jxtlai`: dynamic-call precision and JS/TS relation contracts, three passes.
- `run-1792033452359-hckjd5`: real SDK workflow (21.5 seconds) and provider recovery, two passes.
- `run-1792033577456-92sl8z`: status revision/read-only checks pass; initial graph fixture lacked required provenance.
- `run-1792033745420-aaxwrl`: continuous-edit queue and CAS preview pass.
- `run-1792033881410-2b94om`: real-source impact/context/test selection and expanded GC preview pass. Earlier fixture iterations corrected a missing intermediary, a normally excluded build-directory source path and the `testPath` field name; assertions were not relaxed.
- `run-1792033937879-kmasbu`: installed Pyright and two signature matrices, three passes. Initial real-provider cleanup failed with EBUSY; provider runtime now closes before temporary-package removal.
- `run-1792033992891-wdag50`: both federation cases pass; MCP schema snapshots correctly fail on the changed schema.
- `run-1792034129931-j81gi9`: refreshed MCP snapshots, semantic/incremental identity and context contracts, six passes. Runner strips snapshot-update overrides; fixture snapshot was refreshed from its generated actual output.

The final local front gate passes: format, config budget, environment usage, generated-surface freshness, command surface, workflow contract, and all 39 gate cases (`run-1792034452278-wqhjyh`, zero failures/skips/retries/timeouts). Seven native TUI redraw/state tests pass on Rust 1.88.0. The late MCP apply mapping passed its affected schema/GC tests (`run-1792034688028-m6142q`); formatting was rerun. Hosted CI is not yet final-head acceptance.

## Local source candidate and upgrade

Implementation revision: `2df016bcf`; final documentation/receipt commits do not change its runtime files. Package version remains `0.3.0`; identify this local candidate by its Git revision and archive SHA-256, not a new public version.

The baseline source archive (`a8c1973`) was extracted to a task-owned installation and bootstrapped with `npm run bootstrap:ci`. Required native modules and patches passed verification and wrote a real readiness receipt. Optional `sharp` was absent; no claim is made for that optional backend. The installed wrapper reports version 0.3.0 and its export contract fixture passes. The installed baseline builds a one-file index and finds `baselineAddition` via the CLI.

The candidate source archive was overlaid on that installation. Dependencies and lockfile are unchanged. `node tools/setup/rebuild-native.js --verify` reverified the prepared dependencies and refreshed readiness. The candidate reads the existing index and unchanged repository configuration, then an incremental rebuild after renaming the function finds `upgradedAddition` through the installed CLI. Neither test deletes or rebuilds the user's indexes. An initial diagnostic config incorrectly included test-only `sqlite.use`; the public validator rejected it, and the diagnostic was corrected to use supported config.

Historical local logs: `baseline-bootstrap.log`, `baseline-installed-smoke.log`, `baseline-installed-workflow.log`, `candidate-native-verify.log`, and `candidate-installed-workflow.log` under `temp/tasks/product-wins-20261014`. The machine-readable receipt carries the install/upgrade outcomes.

For a fresh local source install, extract the final archive to an empty directory, use Node 26.x plus Python/C++ native-build prerequisites, run `npm run bootstrap:ci`, then `node bin/pairofcleats.js --version`. The tested same-dependency upgrade used an archive overlay followed by native verification. This does not qualify npm publication, standalone binaries, or other platforms.
