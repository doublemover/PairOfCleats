# October 7 integration and security evidence

Status: Dated checkpoint, not a release-readiness declaration
Canonical execution queue: [roadmap](../roadmap.md)

## Integrated source and lineage

Main `2529d718db780da22c49f188202b6f1550a1833d` has tree
`075ce2b2f86f47d42f2f6195ceab866b4fe86491`, identical to the tested PR542 head
`8c0d86e6c7a698ead3af60535e91145b5023e5b4`. Its parents are prior main
`8f920c620915169b7203e20350d85a3047dc97fc` and that corrective head. The ordinary
merges preserve the completion, dependency-family and security-fix ancestry.

| Integration | Outcome |
| --- | --- |
| [PR519](https://github.com/doublemover/PairOfCleats/pull/519) | Completion integration merged as `71f84342`; bugs #513-517 closed with regression evidence. |
| [PR525](https://github.com/doublemover/PairOfCleats/pull/525) | Maintenance CI and deterministic fixture repairs merged as `1837e11b`. Date-only TTL control replaces a scheduling-sensitive 25 ms test. |
| [PR538](https://github.com/doublemover/PairOfCleats/pull/538) | Checkout/setup-node/github-script/cache family merged as `3f8da13e`, retaining original proposal ancestry and updating maintenance workflows too. |
| [PR539](https://github.com/doublemover/PairOfCleats/pull/539) | Better-sqlite3 13.0.3 merged as `ba9f6779`; native query, SQLite 3.53.4 and source-recovery compatibility verified. Node24 retained. |
| [PR529](https://github.com/doublemover/PairOfCleats/pull/529) | Crossterm 0.29 merged as `f0fd3294` after Rust and platform checks. |
| [PR532](https://github.com/doublemover/PairOfCleats/pull/532) | Vue/file-type/tinybench/pyright/Ajv/tar-stream family merged as `25cc90c4`; actual fixture-target omissions repaired without lowering SLO thresholds. |
| [PR541](https://github.com/doublemover/PairOfCleats/pull/541) | Three source-security fixes, Rust CodeQL build-mode repair and bounded CLI parsing correction merged as `8f920c62`. |
| [PR542](https://github.com/doublemover/PairOfCleats/pull/542) | Watched-file preflight fingerprint correction merged as `2529d718`; missing filesystem import restored with red/green regression coverage. |

All proposals #519-542 are closed: 22 merged, two specifically superseded.
PR521's RE2 1.27.0 and PR523's ONNX Runtime 1.30.0 were already present through
PR519. Other acorn, serde, serde_json, terminal-kit, chardet and provenance-action
updates were individually checked and merged. At the post-merge read-back there
were zero open issues and zero open PRs; later work should use its own receipts.

## Executed validation

The [PR542 exact-head run](https://github.com/doublemover/PairOfCleats/actions/runs/37642969134)
passes gate, Rust TUI, Ubuntu, macOS and Windows. The ordered CI-lite manifest has
887 entries. Ubuntu/macOS execute all entries; the POSIX-only signal check remains
a declared Windows skip. Checks are evidence for that tree, not every optional
native component or interactive platform behavior.

Local corrective validation used Linux and Node 24.19.0. Eight cache/preflight/
metadata tests and all 35 gate tests passed with zero failures, timeouts or skips.
The added same-length file-change assertion fails on uncorrected main and passes
after restoring the import. It also checks default stat mtime/size, missing files
and rejection of stale memory/persisted markers. An independent review and an
explicit undefined-identifier audit found no other dangling import in the cache
migration. Format, lint, generated freshness, config/environment and command-surface
checks passed. Each test retained the 30-second limit.

Post-merge [main CI](https://github.com/doublemover/PairOfCleats/actions/runs/37645271430)
and [actual main CodeQL analysis](https://github.com/doublemover/PairOfCleats/actions/runs/37645637692)
also pass on exact main `2529d718`. Ubuntu/macOS record 887 passes each; Windows
records 886 passes, one declared POSIX-signal skip and no failures/timeouts. The
actual analysis records are JavaScript `1909533465` (16 results, 87 rules) and Rust
`1909494262` (zero results, 26 rules), both without analysis-level errors or warnings.
The automatic push CodeQL run
`37645271393` skipped extraction under the existing 60-minute rate limit; its green
job status is not an analysis receipt. The explicit validation run above uses the
unchanged workflow-dispatch entry point and does not alter permissions or coverage.

## Source-security scope

The old generated-protobuf regular expressions were gone, but their replacement
still repeatedly searched the same prefix. PR541 moves the final-slash lookup
outside the dot loop. A 65,536-dot regression exercises actual artifact lookup
and deterministic operation-count bounds, rather than a machine-sensitive timer.

Structural tools now use the shared Windows invocation handler instead of an
independent command-text quoting routine. Native Windows regressions cover rule
arguments, special-character paths, working-directory resolution and exit status;
NUL/CR/LF input is rejected before spawn. Separate executable argv remains separate.

Untrusted repository configuration no longer controls the tooling-cache destination.
Writers reject link/junction escapes and pruning only removes verified owned cache
records. Reproduction and repair tests used freshly created temporary files only.
Legacy/unrelated records remain untouched. These path-based checks are not an OS
sandbox against concurrent hostile same-user filesystem mutation. PR542 preserves
these guards while restoring real watched-file cache invalidation.

Rust CodeQL uses supported no-build analysis rather than unsupported autobuild.
Languages, permissions, categories and triggers are preserved. Production Rust
extraction succeeded at the earlier main checkpoint; three standalone parser
fixtures lack Cargo manifests, so their compiler-backed extraction remains limited.

## Hosted security inventory

At 2026-10-07 15:55:37 UTC on exact main `2529d718`:

- All 216 Dependabot notices are fixed: six critical, 98 high, 101 medium and 11 low.
- Advisory-range checks cover every matching current lockfile path. For 206 notices
  all locked versions are outside the affected range; for ten the package is
  absent. Runtime, development and optional exposure were distinguished. Both
  JavaScript and Rust lockfiles are unchanged through corrective main `2529d718`.
- Code scanning has 59 notices: 12 open, 30 fixed and 17 previously dismissed.
  Every open notice and historical dismissal was evaluated; older fixed records
  received high-level reconciliation, not individual exploit retesting.
- [Notice63](https://github.com/doublemover/PairOfCleats/security/code-scanning/63)
  automatically became fixed after the Windows-wrapper repair. No alerts were
  manually dismissed or otherwise changed in the closeout.
- Provider and explicit generic secret queries returned zero. Provider scanning
  and push protection are enabled, but generic/non-provider detection and validity
  checks are disabled. Zero generic results do not prove generic-secret coverage.

The remaining CodeQL matches involve non-cryptographic cache/process identities,
test helpers and assertions, and a redundant type-normalization replacement.
Their source-specific conclusions do not turn truncated hashes into security
boundaries. Concrete follow-ups include exact POSIX root identity under a shared
preflight cache and an exact-value Rust pin assertion in the general workflow test.
The CodeQL-specific workflow test already has parsed exact-value checks. Hash
collision and same-user cache-mixing limits remain explicit; no blanket dismissal
or absence-of-vulnerabilities claim is made.

## Acceptance still open

- Original Windows cold-index parity cleanup and its EBUSY failure. The current
  report fixture uses canonical seeded artifacts and real SQLite/search, so its
  pass does not diagnose the old cold full-build setup.
- Representative free-text/Boolean/phrase/filter/ANN retrieval quality and optional
  native backends, repeated snapshot/as-of/index-generation transitions, and
  production resource-lifecycle acceptance.
- Stage1 throughput/memory, IO, cancellation and backpressure measurements on the
  intended release candidate, with the 30-second per-test policy intact.
- Real-project SDK/tooling and final interactive TUI/native-platform acceptance.
- Basename BUILD import classification; fixture target existence is now covered,
  while the production resolver classification remains a recorded gap.

The monthly maintenance source remains `hydro/complete-outstanding-work` in
the existing policy. Any source-branch decision is separate from this evidence
refresh. Historical records remain historical and are not promoted to fresh proof.
