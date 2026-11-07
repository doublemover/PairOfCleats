# Product follow-up receipt — 2026-10-15

Scope: online whole-repository GC, new-file freshness and broader lexical search
qualification on `codex/pr557-audit-repairs-20261012`, based on `1a3e2788e`.
Node 26.8.1, Windows/PowerShell. Embeddings and broad cross-platform CI remain
excluded. This receipt is historical evidence; `docs/roadmap.md` owns active status.

## Delivered behavior

- Local cache admission and process-lifetime leases protect retained readers,
  writers and watchers. Exclusive deletion blocks new readers. Explicit index and
  database paths participate. Dead local owners are reaped, uncertain owners stay
  protected, and protected bytes remain in quota accounting. See the
  [GC contract](../specs/cache-cas-gc.md) for upgrade and host boundaries.
- Status uses shared indexing discovery with ignore, generated-policy, records,
  routing and byte-cap rules, including untracked files. Discovery is limited to
  5,000 candidate files with a two-second cancellation signal. Inaccessible
  traversal is unavailable; truncated/stat-failed scans are partial. Added paths
  are compared only with a complete indexed inventory, with lists capped at 100.
  Indexed hashes retain their separate 5,000-file/8 MiB/two-second bounds. This is
  observed candidate coverage, not an atomic filesystem snapshot or proof that
  every candidate produces chunks. Saved watcher identity remains unverified.
- Discovery reservations now release for early ignored/generated/outside-root
  candidates as well as stat failures; ignored files cannot stall capped scans.
- A real eight-file application index exercises ten lexical queries: symbols,
  split identifiers, quoted phrases, documentation, checksums and error text.
  Nine expected files rank first; split `refund payment` ranks second, MRR 0.95.
  This qualifies a bounded fixture, not production-corpus relevance or embeddings.

## Validation and corrections

Author-workspace `.testLogs` paths below are historical and are not promised in
clean checkouts.

- `run-1792037691868-r1ukst`: search quality passed in 17.8 seconds. An initial
  quoted-comment query incorrectly used code mode, which intentionally excludes
  comments. The fixture now builds/searches extracted prose for documentation;
  the phrase matcher was not weakened. Status initially failed due to an incorrect
  policy-owner import, then passed after correction.
- `run-1792037765232-oiw1zn`: four cache/freshness checks passed, including real
  CLI apply against a separate live reader, dead-reader recovery, admission during
  cleanup, explicit-path admission, quota accounting and preview/apply behavior.
- `run-1792037830452-u8kljk`: four discovery checks and freshness passed. The path
  parity fixture exposed inherited test-cache defaults; it now supplies isolated
  config through the standard test-environment helper instead of assuming local
  project config overrides the runner.

- `run-1792037906976-kx2fe4`: MCP schema/version and SQLite cache passed;
  path-pointer and shared SQLite generation fixtures failed on missing canonical
  format identities. Fixtures now use the canonical surface constant/SQLite
  metadata writer; invalid-table fallback retains a valid format identity.
- `run-1792037997233-9q41uk`: all four corrected path/cache/discovery checks pass,
  including collector-crash recovery. No retries, skipped checks or longer limits.

- `run-1792038096735-xfj3lc`: final search quality (12.1 seconds), process leases,
  freshness and three documentation checks passed. Manifest read-plan fixture
  failed on its missing format identity; its synthetic successful read now includes
  `ARTIFACT_SURFACE_VERSION` without changing retry assertions.
- Final front gate passed: `npm run format`, `npm run config:budget`,
  `npm run env:check`, generated-surface freshness, command-surface audit, workflow
  contract, all 39 gate cases (`run-1792038091356-v05lfl`, 5.62 seconds), and
  `git diff --check`. Later changes only correct fixture metadata and this receipt;
  affected checks are rerun before publication.

- `run-1792038200126-hw2fjg`: final format passed again; the corrected manifest
  read-plan and all three documentation checks pass (four cases, 1.33 seconds).

The tests remain bounded at 30 seconds with no retries or skipped cases. No
full-index, platform, embedding, release or retained-heap campaign is claimed.
The branch remains a PR candidate; publication does not authorize a merge.
