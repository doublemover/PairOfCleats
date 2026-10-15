# Dependency and CI reconciliation, 2026-10-14

Base: `d6041226b95baa6d7be8c6a06611b6d9e452d4ba`.
Canonical status: [roadmap](../roadmap.md).

## Dependency batch

Commit `dae8ecd62` integrates the ten npm updates represented by Dependabot
PRs #559-568 and the coordinated upload-artifact 7/download-artifact 8 updates
from #569-570. JSON-RPC 9 requires the explicit Node entry point to install its
runtime adapter. The regenerated npm lockfile preserves manifest/optional-root
consistency; the Parcel watcher installation allowance follows version 2.6.0.
The workflow contract retains explicit reviewed action versions.

Node 26.8.1 `npm run bootstrap:ci` completed with patches, required native builds,
registered grammar activation and a verified readiness receipt. Optional Sharp
was absent. npm reported zero vulnerabilities. Dependency-security and workflow
contracts passed; formatting/ESLint passed before commit.

Twenty selected dependency regressions passed: JSON-RPC framing/lifecycle,
safe-regex, HTML, Handlebars, TOML, doc-comments, PDF, Parcel backend selection,
map viewer contracts, MCP legacy/SDK initialization and LSP timeout/shutdown.
The first selection had 18 passes, one failure and one timeout: an inherited
`PAIROFCLEATS_TRUSTED_CONFIG` referenced a nonexistent external file. Removing
that variable only in the test command environment allowed the two affected MCP
cases to pass in 10.6/10.0 seconds. Persistent user settings were not changed.

Historical author-workspace logs (not clean-checkout deliverables):
`.testLogs/run-1792028566366-3cft1x` and
`.testLogs/run-1792028631162-qlgq4j`.

## CI debt

Hosted run 38316114996 on the base SHA failed Ubuntu/macOS (934 passed, eight
failed each) and Windows (934 passed, seven failed, one skipped). Gate and
Rust TUI passed. No hosted rerun has yet qualified the changes here.

Repairs align fixtures with compact manifest publication, immutable bundle
snapshot publication, removed legacy context lines and independently owned
embedding leases. Standalone embedding builds now explicitly test provider
disposal while retaining vector-cache reuse. Query workers now own the POSIX
process group declared to the termination helper, use its actual signal option,
and join child close after termination. The stubborn-child fixture waits for
the actual startup handshake instead of conditionally accepting a missing PID.

All eight previously failing fixtures pass locally, serially, with a 30-second
per-case deadline, zero retries and native redo disabled. Initial local results
were six passes/two failures; the remaining manifest dependency field and legacy
context expectations were corrected, then just those two cases passed.
Historical author-workspace logs: `.testLogs/run-1792028699419-ulteor` and
`.testLogs/run-1792028748281-j1r1cv`. Windows acceptance does not qualify POSIX
process groups; Linux/macOS hosted confirmation remains outstanding.

No push, merge, bot-PR closure, full index or release qualification is recorded.

## Additional front-gate repair

The environment-usage checker originally traversed historical temp checkouts
and test-log probes. It now prunes excluded directories before traversal,
including task-owned temp and test logs. A new focused regression proves actual
source/tool violations remain rejected while the environment owner is allowed.
The focused case passed in 403ms; historical local receipt:
`.testLogs/run-1792029818563-nz47rp`. Config inventory was regenerated.

The first generated-surface check failed because four archived source receipts
were checked out as CRLF despite their existing LF attributes. Each file was
verified against its committed Git bytes, then restored to those exact bytes.
No archive content or contract was changed. Freshness subsequently passed.
