# Windows CI and native-path follow-up — October 29, 2026

Implementation: `0426ad8ab`, following `696b8de61`. The adjacent
[durable receipt](windows-ci-native-path-followup-2026-10-29.json) records exact
source hashes, package identities, complete focused reports and original controls.
Author-workspace `.tmp/` and `.testLogs/` paths are historical locations; their
embedded reports and hashes are retained here without promising those files in
a clean checkout.

## Repairs

- Retained semantic source verification and excerpts preserve the authorized
  lexical path. Canonicalizing only the target lost Windows extended-length
  paths and legitimate aliased ancestors. The existing contained reader still
  rejects links and checks descriptor identity, source bytes, hashes and scalar
  boundaries. An extended-length-path regression creates no links: restoring
  the old resolver fails; the repair passes.
- LSP restart fixtures wait until the actual wall-clock backoff deadline before
  their single restart attempt. An early timer no longer fails one millisecond
  before readiness. Original child-close, tree-settlement and premature-restart
  negatives remain intact; the production backoff guard is unchanged.
- Search microbenchmarks no longer forward an undeclared, ineffective search
  `--quality` flag. That flag was introduced in this PR at `c6275bd85`; it had no
  runtime consumer. The positive cache fixture selects balanced quality through
  the supported repository configuration. Real source hits, cache misses/hits,
  retrieval work, ranking identities and baseline exclusions remain asserted.
- LanceDB advances **0.40.0 → 0.41.0**, including all seven native platform
  packages. The release's Arrow peer range now admits the selected Arrow 21.
  A registry recheck finds only the documented TypeScript 6 compiler/server
  compatibility exception behind its upstream latest tag.
- Lance 14.0.2 still fails to persist native files when its write path exceeds
  Windows MAX_PATH, including when the caller supplies an extended-length path.
  The production allocator now writes inside a shorter private directory in
  the launch-authorized repository cache. The existing publication owner moves
  only a closed, validated payload into the same-volume immutable generation.
  External indexes retain their existing root; no parent-path inference grants
  new authority. No backend is disabled or substituted. The new real-native
  regression fails with the old allocator and passes after repair, including
  querying the relocated generation beyond MAX_PATH. Arbitrarily long cache
  roots and direct upstream long-path writes are not qualified by this repair.
- Native validate/search overlaps independent console-observer initialization
  with the complete canonical seed build. The native child starts after seed
  completion, preserving its original 18-second lifetime. The 26-second capture
  and 30-second fixture bounds remain unchanged. Setup now requires an available
  real LanceDB backend, preventing a degraded seed from masquerading as success.
- Windows snapshot diagnostics retain elapsed interop/setup phases. The actual
  two-second discovery deadline, complete lineage positive, incomplete-enumeration
  rejection and resource-close negatives remain unchanged. This is diagnostic
  progress, not a demonstrated repair of the hosted cold-start timeout.

## Setup and focused qualification

Node **26.13.0**, Windows x64, ABI **147**; LanceDB **0.41.0**. An initial lock
resolution omitted its Windows optional binding. Refreshing registry metadata
repaired the lock. The first locked install still omitted that package, and
required native verification correctly rejected readiness. Installing the exact
resolved optional package through npm, rechecking all seven patches and running
the existing required verification restored valid readiness. The final verify
exits **0**; no marker or backend bypass is used. The install audit reports zero
vulnerabilities. Upstream `prebuild-install@7.1.3` deprecation remains visible.

The new native-generation case passes in **12.1 seconds**. Another **14/14**
focused cases pass serially with one runner job, a one-thread launch hint,
30-second deadlines, zero retries and native-status redo disabled. They include
native validate/search (**22.9 seconds**), actual custom-column LanceDB writes
and queries, Arrow contracts, failed-close/retained-owner controls, source
integrity, LSP restart, actual Windows snapshots and benchmark accounting.
The existing local TUI binary is identified by hash; no new Rust binary or
cross-platform runtime qualification is implied.

All eight publication checks pass, including **40/40 gate fixtures**, with no
failures, timeouts or skips. Runtime/test source remains unchanged through the
gate; the receipt records Git and Windows byte identities. This is focused
acceptance, not an unfiltered deep-suite pass.

## Hosted evidence and remaining work

Run `40845842123`, PR head `696b8de61`, observes macOS **1,368 passed / one failure /
one skip**; the remaining cache fixture is repaired above. Windows snapshot-create
passes hosted in **29.1 seconds**; validate/search exceeds the outer fixture bound
after its assertions. The two repaired source/fixture problems and the separate
Windows snapshot-helper startup timeout stopped other required cohorts early.
These observations do not qualify the new source or dependency tree.

The earlier Windows ANN lazy-import and Sublime API-authentication timeouts both
stall during the sample index build before their main assertions. Fresh small
builds with explicit four-thread fast/max policies pass locally; the shared hang
has not been attributed or proven fixed. Preserve those original failures.

Required hosted authority and final CI acceptance remain open. P1 #1288 actual
VSIX host installation/activation and #1574 cleanup qualification remain separate.
