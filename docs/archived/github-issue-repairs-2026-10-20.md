# GitHub issue repair receipt, October 20, 2026

Status: Active. The execution order and current summary remain in [the roadmap](../roadmap.md).

Initial census: 78 open issues, #584–#661, all audited against `6bd0c1e2be7979286cdcf19a38542429077865f2`. Work continues on `codex/pr557-audit-repairs-20261012` and PR #572. The earlier frozen Windows campaign remains historical evidence and does not qualify these new changes.

All issues remain open until their own acceptance criteria, retained coverage, and publication evidence are verified. No issue is dismissed because the previous suite passed. Platform, optional-tool, workload and TUI feature requests are included in scope.

Execution order: P1 resource/publication/runtime defects; related service, API, retrieval and semantic correctness; editor/runtime and provider tooling; harness and hosted coverage; TUI workflow completion; Linux/macOS deep, native, optional-tool and representative workload qualification. Dependencies may move a repair earlier.

## Initial issue inventory

| Issue | Requested repair | State |
| --- | --- | --- |
| [#584](https://github.com/doublemover/PairOfCleats/issues/584) | [P1] Keep legacy MCP capacity reserved until timed-out tool teardown settles | Implemented; local regressions pass; publication pending |
| [#585](https://github.com/doublemover/PairOfCleats/issues/585) | [P2] Recover dead cleanup owners before rejecting normal cache readers | Pending acceptance |
| [#586](https://github.com/doublemover/PairOfCleats/issues/586) | [P2] Propagate MCP cancellation and deadlines through synchronous maintenance handlers | Pending acceptance |
| [#587](https://github.com/doublemover/PairOfCleats/issues/587) | [P2] Allow filter-only federated searches through HTTP request validation | Pending acceptance |
| [#588](https://github.com/doublemover/PairOfCleats/issues/588) | [P2] Reconcile restored paused TUI selection against the new session | Pending acceptance |
| [#589](https://github.com/doublemover/PairOfCleats/issues/589) | [P2] Give artifact-page rows identities independent of their display name | Pending acceptance |
| [#590](https://github.com/doublemover/PairOfCleats/issues/590) | [P2] Hydrate semantic query results using their envelope generation | Pending acceptance |
| [#591](https://github.com/doublemover/PairOfCleats/issues/591) | Honor watch cancellation before publishing a validated generation | Pending acceptance |
| [#592](https://github.com/doublemover/PairOfCleats/issues/592) | Parse LSIF item edges in their specified result-to-range direction | Pending acceptance |
| [#593](https://github.com/doublemover/PairOfCleats/issues/593) | Separate GNU Global cxref source text from ingested filenames | Pending acceptance |
| [#594](https://github.com/doublemover/PairOfCleats/issues/594) | Fail closed when CAS GC cannot read the full reachability inventory | Pending acceptance |
| [#595](https://github.com/doublemover/PairOfCleats/issues/595) | Preserve Python signatures with comparison and shift defaults when finding the parameter-list end | Pending acceptance |
| [#596](https://github.com/doublemover/PairOfCleats/issues/596) | Align TypeScript doctor compatibility with the compiler host API requirements | Pending acceptance |
| [#597](https://github.com/doublemover/PairOfCleats/issues/597) | Align first-run prerequisites with mandatory Node 26.10 and native source builds | Pending acceptance |
| [#598](https://github.com/doublemover/PairOfCleats/issues/598) | Give promoted release assets unique filenames instead of only unique display labels | Pending acceptance |
| [#599](https://github.com/doublemover/PairOfCleats/issues/599) | Reconcile required pre-merge CI Long policy with tag/manual-only execution | Pending acceptance |
| [#600](https://github.com/doublemover/PairOfCleats/issues/600) | Apply Boolean/literal eligibility before exhausting the SQLite FTS candidate window | Pending acceptance |
| [#601](https://github.com/doublemover/PairOfCleats/issues/601) | Keep federated prose enumeration confined to the selected eligible mode | Pending acceptance |
| [#602](https://github.com/doublemover/PairOfCleats/issues/602) | Expire or time-bind federated cache entries for relative modification filters | Pending acceptance |
| [#603](https://github.com/doublemover/PairOfCleats/issues/603) | Delete semantic_discovery rows when removing a stale analysis partition | Pending acceptance |
| [#604](https://github.com/doublemover/PairOfCleats/issues/604) | Preserve artifact projection identity and restore permitted metadata across owner privacy changes | Pending acceptance |
| [#605](https://github.com/doublemover/PairOfCleats/issues/605) | [P2] Honor configured retries for background jobs with no per-job override | Pending acceptance |
| [#606](https://github.com/doublemover/PairOfCleats/issues/606) | [P1] Dispose claimed-job resources when progress setup or state synchronization fails | Implemented; local regressions pass; publication pending |
| [#607](https://github.com/doublemover/PairOfCleats/issues/607) | [P2] Fence shared log/report cleanup against concurrent queue partitions | Pending acceptance |
| [#608](https://github.com/doublemover/PairOfCleats/issues/608) | [P2] Enforce the configured running-job cap atomically at claim time | Pending acceptance |
| [#609](https://github.com/doublemover/PairOfCleats/issues/609) | [P2] Keep repository-targeted MCP cache cleanup within its requested scope | Pending acceptance |
| [#610](https://github.com/doublemover/PairOfCleats/issues/610) | [P1] Bundle the runtime config contract inside the Sublime package | Implemented; local regressions pass; publication pending |
| [#611](https://github.com/doublemover/PairOfCleats/issues/611) | [P2] Include the selected index root and generation in code-map cache identity | Pending acceptance |
| [#612](https://github.com/doublemover/PairOfCleats/issues/612) | [P2] Send destination-bound authentication for Sublime API workflows | Pending acceptance |
| [#613](https://github.com/doublemover/PairOfCleats/issues/613) | [P2] Keep cancellation and watch paths compatible with the advertised Sublime runtime | Pending acceptance |
| [#614](https://github.com/doublemover/PairOfCleats/issues/614) | [P2] Launch checkout JS commands with a supported external Node runtime | Pending acceptance |
| [#615](https://github.com/doublemover/PairOfCleats/issues/615) | Make the nightly soak selector select a real case before claiming extended qualification | Pending acceptance |
| [#616](https://github.com/doublemover/PairOfCleats/issues/616) | Remove duplicate nightly execution paths for the same script-coverage fixtures | Pending acceptance |
| [#617](https://github.com/doublemover/PairOfCleats/issues/617) | Validate resolved script-coverage targets instead of a regex that matches none of them | Pending acceptance |
| [#618](https://github.com/doublemover/PairOfCleats/issues/618) | Restore explicit hosted coverage for API authorization and search contracts | Pending acceptance |
| [#619](https://github.com/doublemover/PairOfCleats/issues/619) | [P2] Apply TUI viewport offsets and render the live log tail | Pending acceptance |
| [#620](https://github.com/doublemover/PairOfCleats/issues/620) | [P2] Handle Ctrl+C distinctly from the ordinary cancel-job shortcut | Pending acceptance |
| [#621](https://github.com/doublemover/PairOfCleats/issues/621) | [P2] Preserve an explicit empty graph selection in context packs | Pending acceptance |
| [#622](https://github.com/doublemover/PairOfCleats/issues/622) | [P2] Reconcile semantic evidence metadata after response-budget omission | Pending acceptance |
| [#623](https://github.com/doublemover/PairOfCleats/issues/623) | [P2] Enforce suggest-tests maxNodes before admitting seeds and neighbors | Pending acceptance |
| [#624](https://github.com/doublemover/PairOfCleats/issues/624) | [P2] Preserve ordinary source and query payloads in SSE search results | Implemented; local regressions pass; publication pending |
| [#625](https://github.com/doublemover/PairOfCleats/issues/625) | [P2] Forward MCP index-build cancellation into the core build lifecycle | Pending acceptance |
| [#626](https://github.com/doublemover/PairOfCleats/issues/626) | Scope LSP response-cache keys to the document, not just identical source bytes | Pending acceptance |
| [#627](https://github.com/doublemover/PairOfCleats/issues/627) | Parse Rust lifetimes and tuple returns without corrupting signature metadata | Pending acceptance |
| [#628](https://github.com/doublemover/PairOfCleats/issues/628) | Preserve grouped Go parameters and channel directions in LSP signatures | Pending acceptance |
| [#629](https://github.com/doublemover/PairOfCleats/issues/629) | Do not publish retained old ANN artifacts as ready under a new embedding identity | Pending acceptance |
| [#630](https://github.com/doublemover/PairOfCleats/issues/630) | Complete the declared Linux/macOS deep and native release-target qualification | Pending acceptance |
| [#631](https://github.com/doublemover/PairOfCleats/issues/631) | Resolve remaining real optional-tool installation and post-install verification blockers | Pending acceptance |
| [#632](https://github.com/doublemover/PairOfCleats/issues/632) | Establish representative retrieval, edit-to-search and retained-memory evidence | Pending acceptance |
| [#633](https://github.com/doublemover/PairOfCleats/issues/633) | TUI missing functionality: select repositories and safely edit validated configuration | Pending acceptance |
| [#634](https://github.com/doublemover/PairOfCleats/issues/634) | TUI missing functionality: run real searches and navigate ranked results/source | Pending acceptance |
| [#635](https://github.com/doublemover/PairOfCleats/issues/635) | TUI missing functionality: configure and operate index and embedding workflows | Pending acceptance |
| [#636](https://github.com/doublemover/PairOfCleats/issues/636) | TUI missing functionality: expose doctor and supported tooling/provider setup | Pending acceptance |
| [#637](https://github.com/doublemover/PairOfCleats/issues/637) | TUI missing functionality: control owned services and preview maintenance actions | Pending acceptance |
| [#638](https://github.com/doublemover/PairOfCleats/issues/638) | TUI missing functionality: select jobs and inspect their results/artifacts | Pending acceptance |
| [#639](https://github.com/doublemover/PairOfCleats/issues/639) | TUI missing functionality: open recorded sessions and explicitly distinguish passive/live attachment | Pending acceptance |
| [#640](https://github.com/doublemover/PairOfCleats/issues/640) | TUI missing functionality: expose registered analysis/report workflows with command-surface parity | Pending acceptance |
| [#641](https://github.com/doublemover/PairOfCleats/issues/641) | Hash the full admitted triage payload before using it as fallback record identity | Pending acceptance |
| [#642](https://github.com/doublemover/PairOfCleats/issues/642) | Preserve a single generic triage record when it contains array-valued fields | Pending acceptance |
| [#643](https://github.com/doublemover/PairOfCleats/issues/643) | [P2] Accept the risk truncation caps actually emitted by context-pack assembly | Pending acceptance |
| [#644](https://github.com/doublemover/PairOfCleats/issues/644) | [P2] Make strict risk fail when either required stats or summaries are missing | Pending acceptance |
| [#645](https://github.com/doublemover/PairOfCleats/issues/645) | [P2] Preserve directed graph edges and call-site evidence during incoming traversal | Pending acceptance |
| [#646](https://github.com/doublemover/PairOfCleats/issues/646) | [P2] Read risk guidance from CSR adjacency instead of stripped metadata nodes | Pending acceptance |
| [#647](https://github.com/doublemover/PairOfCleats/issues/647) | Honor the repository model when --model is omitted | Pending acceptance |
| [#648](https://github.com/doublemover/PairOfCleats/issues/648) | Do not skip configured model setup because an unrelated cache entry exists | Pending acceptance |
| [#649](https://github.com/doublemover/PairOfCleats/issues/649) | Keep interactive setup prompts off JSON stdout | Pending acceptance |
| [#650](https://github.com/doublemover/PairOfCleats/issues/650) | Refetch missing dictionary bytes instead of accepting a stale 304 receipt | Pending acceptance |
| [#651](https://github.com/doublemover/PairOfCleats/issues/651) | [P2] Honor service subprocess timeout and capture defaults when options are omitted | Pending acceptance |
| [#652](https://github.com/doublemover/PairOfCleats/issues/652) | [P1] Fix the undeclared error projection in streaming search failure handling | Implemented; local regressions pass; publication pending |
| [#653](https://github.com/doublemover/PairOfCleats/issues/653) | [P2] Preserve unrelated defaults when normalizing partial service configuration | Pending acceptance |
| [#654](https://github.com/doublemover/PairOfCleats/issues/654) | [P1] Preserve atomic target visibility during normal shared file replacement | Implemented; local regressions pass; publication pending |
| [#655](https://github.com/doublemover/PairOfCleats/issues/655) | [P2] Normalize accepted sync policies before selecting Git operations | Pending acceptance |
| [#656](https://github.com/doublemover/PairOfCleats/issues/656) | Pass the Python AST, not relPath, into the language registry relation builder | Pending acceptance |
| [#657](https://github.com/doublemover/PairOfCleats/issues/657) | Keep distinct virtual document origins when VFS hash routing is enabled | Pending acceptance |
| [#658](https://github.com/doublemover/PairOfCleats/issues/658) | Translate Python AST UTF-8 columns before building JavaScript source ranges | Pending acceptance |
| [#659](https://github.com/doublemover/PairOfCleats/issues/659) | Map Python positional-only defaults over the combined positional parameter list | Pending acceptance |
| [#660](https://github.com/doublemover/PairOfCleats/issues/660) | Wire HTML metadata through registry relations and chunk enrichment | Pending acceptance |
| [#661](https://github.com/doublemover/PairOfCleats/issues/661) | [P2] Do not report removed risk flows when an artifact failed to load | Pending acceptance |

## First repair batch: shared publication and lifecycle owners

Required prepared-dependency verification used the official task-owned Node 26.10.0 runtime and `node tools/setup/rebuild-native.js --verify`: exit 0, 37 required packages, 33 language routes, no warning/error lines. The receipt remains author-workspace evidence under ignored `temp/tasks/windows-deep-repairs-20261018/native-verify-issues-20261020.log`; it is not promised in a clean checkout. Activation remains distinct from runtime qualification.

The first batch repairs #584, #606, #610, #624, #652 and #654. It retains original query, authority, invalid-request and failure assertions; no backend is disabled and no retry/deadline budget is raised.

| Issue | Demonstrated failure | Repair and regression ownership |
| --- | --- | --- |
| #584 | The supported-runtime parser/scheduler fixture admits the next same-lane request before aborted work settles. | Legacy MCP retains execution capacity, request identity and admission occupancy through actual handler/child settlement. Shutdown cancels queued work and awaits active teardown. `services/mcp/legacy-execution-settlement` uses real owned child processes; existing SDK cancellation/timeout/progress coverage remains. |
| #606 | The production worker rejects after monitor initialization without finalizing its claimed job. | Lifecycle ownership begins before fallible setup; finally closes partial resources and clears controls; state-write failures cannot bypass completion. Outstanding heartbeat writes drain before completion. `tooling/service/indexer-queue-worker-setup-failures` covers monitor, initial/final state writes and in-flight renewal. |
| #610 | Importing the complete plugin from a relocated package raises FileNotFoundError. | Generated package-local contract, registry-controlled freshness/parity, editor resource loading for packed packages, source fallback for standalone tools. `tooling/sublime/config-runtime-contract` imports/registers the complete copied plugin and the actual built archive, and verifies resource loading without a disk contract. |
| #624 | With #652 repaired independently, the original SSE serializer still fails JSON/SSE content parity. | Result frames apply the same structured metadata redaction as JSON. Source comments and path-looking queries survive; private observability/retrieval paths remain redacted. `services/api/search-stream-outcomes` covers these together. |
| #652 | A real HTTP streaming request with a failing search throws ERR_HTTP_HEADERS_SENT after the undeclared projection fails. | Project the original format diagnostic in scope, send one error/done outcome and close in finally. Outer recovery never writes JSON headers into an established stream. The HTTP regression covers missing index, incompatible format and generic errors. |
| #654 | A concurrent reader at the first completed rename sees ENOENT on Windows. | Normal async/sync publication uses one atomic overwrite rename. Retained backups are durable copies. EXDEV copies into a unique sibling and commits by rename; blocked commit leaves the original visible. No unlink-and-copy fallback remains. `shared/io/replace-file-visibility` observes every commit boundary, interrupted staging, blocked publication, retained backups and eight actual process exits immediately before/after commit. |

The existing EXDEV fixtures previously injected EXDEV into every rename, including impossible same-filesystem sibling commits. Their injection now models the original cross-device source only; all final-content, cleanup and fallback telemetry assertions remain. The prior backup-swap assertion now requires that failed publication never rename the visible original away. The new visibility fixture directly proves the atomic behavior that the previous implementation violated.

Fail-before receipts (all supported Node 26.10.0, first attempt, one job, 30-second deadlines, zero retries) are preserved in the ignored author-workspace task directory: `issue-584-before.log`, `issue-606-before.log`, `issue-610-before.log`, `issue-624-before.log`, `issue-652-before-clean-env.log`, `issue-654-before.log`. An early MCP fixture prototype exited when production stdin-end fired; its apparent green observation is not acceptance evidence. The completed fixture detaches its own stdin subscriptions before awaiting work and demonstrably fails the original owner.

Local affected checks: 19 API/SSE/SDK/Sublime/visibility fixtures pass without skips; the longest is the real Sublime workflow harness at 22.7 seconds. Five additional legacy-MCP/queue-worker/cancellation/timeout cases pass. The POSIX SIGTERM-resistant descendant fixture explicitly excludes Windows and remains a Linux/macOS execution requirement; it is not counted as passing on Windows. Later lifecycle, renewal and process-exit assertions also pass. Shared persistence checks are rerun against the final batch before publication.

Final local publication gate: `npm run format`, `npm run config:budget`, `npm run env:check`, generated-surface freshness, command-surface validation, standalone workflow contract, all 39 gate cases and `git diff --check` pass. Four additional documentation/governance cases pass. After the final shared-owner edit, all 13 persistence cases pass again (maximum 10.9 seconds), including the retained concurrent-publication/missing-temp idempotence contract. New CI membership adds five cases (976 → 981); all previous ordered IDs remain. Four new physical fixtures bring discovery from 2999 to 3003. No original test is removed. Hosted results and exact publication identity remain pending until read back from GitHub.
