# Product follow-up, October 14, 2026

Base: `2420a12cc08889e3d4820ea3ba5998c404844a3e`, branch
`codex/pr557-audit-repairs-20261012`, PR #572. Windows, Node 26.8.1.
This receipt records bounded local evidence, not release-wide acceptance.
Paths under `.testLogs` and `temp/tasks` below are historical author-workspace
receipts and are not promised in clean checkouts.

## Implemented

- JS/TS Babel relations resolve immutable lexical string keys, simple string
  concatenation, and immutable function aliases. Shadowed/reassigned/TDZ/dynamic
  bindings remain conservative. Parser fallbacks retain their previous behavior.
  Error-recovery ASTs cannot make failed scope construction retain partial proofs.
  Call-flow producer version 12 and incremental signature version 6 invalidate
  prior derived meaning.
- Real filesystem watch, index build, promotion, and search now have a small
  end-to-end regression. Parcel subscriptions were not unsubscribed because the
  API returns an object instead of a function; cleanup now handles both shapes.
  Shutdown prevents new queue work and drains pending updates before final state.
  Core build callers can observe watch readiness and state through callbacks.
- Exact symbol and filename queries receive bounded lexical boosts under the
  existing symbol-boost policy. Explain output identifies the matching evidence.
  Local query-cache key v4 and federated key payload v2 separate old rankings.
  A real SDK search ranks the definition ahead of its callers and test.
- Status hashes indexed source files against published file metadata. It reports
  changed, missing, unchanged, unknown, and truncated evidence. Each mode is
  capped at 5,000 files, 8 MiB of source bytes, and a two-second iteration budget;
  result path lists cap at 100. New/unindexed files are explicitly not checked.
  Watch receipts carry PID/time; status distinguishes stopped/dead/unknown from
  a present but unverified PID. PID presence is not live identity verification.
- MCP search/status import their direct owners; indexing dependencies load only
  when a build tool is called. Real SDK search/context and MCP build progress
  remain functional. The progress test now uses an isolated one-file repository
  instead of unnecessarily activating every language in the large sample tree.
- The shared context-pack API/CLI/MCP boundary caps complete JSON at 128 KiB,
  preserving primary evidence and omitting optional sections with warnings.
  Existing maxBytes/maxTokens remain excerpt limits. Strict required evidence
  that cannot fit fails explicitly; no new configuration knob was added.
- Legacy repository GC preserves lock-bearing caches and rechecks locks before
  apply. Preview reporting distinguishes planned from actually freed bytes.
  This is additional protection for offline cleanup, not an online safety claim.

## Evidence

The passing real-watch run `run-1792036289310-iw75qm` measured 5,241 ms from edit
to published generation and 5,614 ms through successful search; whole fixture
10.7 s. The source file, watcher backend, indexer, promotion, and search were real.
It also passed the status hash-comparison regression. Earlier ENOTEMPTY and
timeout receipts were preserved; they led to queue-drain and Parcel cleanup fixes.

SDK search/context and response-budget tests passed in
`run-1792036370658-89ofcr` (SDK fixture 20.9 s). Watch shutdown, consistency,
stability replay and update queue tests, JS/TS relation contracts, MCP schemas,
and cache GC passed in `run-1792036524397-rlulls`; its oversized MCP build fixture
timed out at 30 seconds and was corrected rather than given a longer deadline.
The corrected build fixture passed in 22.4 s in `run-1792036616663-6mm9fe`, along
with local/federated query-cache contracts and the alias regression.

The same 44-file source sample used for the prior resource receipt received 16
real SDK searches. Actual server private bytes after calls 4/10/16 were
657,960,960 / 525,557,760 / 610,041,856, versus the previous
738,521,088 / 617,410,560 / 650,256,384. Handles stayed at 286 and all descendants
exited. This single bounded sample shows a modest reduction, not a leak proof
or sustained-load benchmark. Historical detailed receipt:
`temp/tasks/product-wins-20261014/session-resources-lazy-imports.json`.

Final publication checks passed: format, config budget, environment usage,
generated-surface freshness, command-surface audit, workflow contracts, all 39
gate cases, and diff whitespace checks. Gate receipt:
`run-1792036901522-cas4kq`, zero failures/skips/timeouts, 6.87 s.
Final changed-path and documentation checks passed in
`run-1792036751016-ne4j8l`; context core/strict-evidence/budget checks passed in
`run-1792036793826-0frqjf`, with the final pretty-JSON budget adjustment checked
in `run-1792036865155-db7bgt`. Earlier failed attempts remain historical failures,
not passing evidence.

## Explicit limits

Safe online deletion of entire repository caches requires lifetime reader leases
and admission coordination. Current writer locks are inside deletion targets
and do not cover all readers. The new guards deliberately do not claim to solve
that protocol. Full freshness also requires new-file discovery and verified live
watcher identity. Search-quality acceptance beyond exact lookups, broader
semantic precision, optional providers, embeddings and release/platform campaigns
remain separately scoped. The previous native crash was not reproduced and is
closed pending new evidence, as requested.

The preceding head's hosted CI passed gate/Rust/Ubuntu/Windows and failed macOS;
those results are historical and not acceptance for this follow-up head.
