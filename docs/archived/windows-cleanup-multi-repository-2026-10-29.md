# Windows multi-repository cleanup qualification — 2026-10-29

Base: `b371cefc382db4b6694b7ea27abd068f9ac20b5d`. The companion JSON records
the exact implementation, source hashes, original fixture failures and checks.
Task-local `.tmp/` and `.testLogs/` paths are historical author-workspace evidence.

## Qualified behavior

Eight independently bounded cases exercise the actual cleanup CLI and MCP
handler, using two tiny disposable repositories and marked fixture caches:

- Live reader, active builder, malformed/unknown owner and saved-evidence
  cases preserve the protected repository while `--all` removes an independently
  eligible sibling. Dry-run preserves both; confirmed owner release permits
  eligible cleanup. The repositories parent and cache ownership marker survive.
- Repository-scoped MCP dry-run and apply select the exact requested fixture,
  preserve its eligible sibling and reject all-repository delegation. The CLI
  removes that sibling only under an explicit subsequent `--all` request.
- A separate hidden PowerShell process opens an actual Windows file handle
  without delete sharing. A rename probe fails with a native sharing error.
  CLI/MCP cleanup remains blocked; the same child then lazily reads the exact
  retained input, closes naturally and exits zero with empty stderr before the
  original reader lease is released. Eligible cleanup then succeeds.
- Actual SQLite WAL and LMDB operations retain readable original values through
  CLI/MCP cleanup. Custom namespace leases remain visible while the handles are
  open. After confirmed native close, custom stores still remain protected:
  a caller generation label and absence of readers never grant deletion.

Four existing repository-path/parity fixtures also pass. All 12 focused cases
pass with one job/thread hint, 30-second fixture bounds, zero retries/native
status redo and no Windows skips. The slowest case takes 3.37 seconds. The eight
new cases belong to the 1,490-case ordered CI-lite inventory. The locked-reader
case is explicitly Windows-specific; its portable peers remain separate.

Repository root discovery now sets `windowsHide` for its existing Git child.
No root-selection, public configuration or backend contract changes accompany
that launch behavior change.

## Preserved failures and limits

The first new fixture run failed seven cases: nested test directories selected
the enclosing author checkout through MCP, and internal `dbDir` settings were
incorrectly placed in strict public configuration. A second run passed both
custom cases and retained five root-selection failures. The final fixtures use
actual tiny Git repositories, assert identical CLI/MCP selection and use the
existing gated test overlay for internal custom backend settings. Public schema
rejection remains intact. No positive assertion was removed or deadline raised.

**#1574 remains partial.** This batch qualifies the existing safety fence and
truthful partial outcomes. Producer/publication-backed registration and eligible
category deletion for custom/external stores remain unimplemented. Remaining
backend adoption and source-specific publication/reader lifetime work retain
their own owners, including #1627; common lifecycle/quota policy remains #1267.
No custom deletion, current/retained generation removal, broad deep-suite pass,
or final hosted candidate pass is claimed. Fixture cleanup validates its exact
disposable task-root boundary; no user cache or security setting is changed.
