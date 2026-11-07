# SQLite fact batching — 2026-11-04

The clean158d7fd6e row-shape campaign passes125 children, then stops on
trial3 baseline large-low build. The original child exceeds30 seconds inside
the native operation, after chunk insertion and during filter-fact rebuilding.
The runner confirms forced child close. Its complete failure, all125 prior
observations and exact inputs remain in the [machine receipt](windows-sqlite-fact-batching-repair-2026-11-04.json).
It is a timeout, not an access violation; no status retry or deadline change is used.

The rebuild already reads ordered128-row source pages, but makes one native
write per document. A real installed-owner work regression fails before repair:
128 native writes instead of one. Reconstruction now uses the existing bounded
multi-row owner, preserving128-row pages and999-variable ceiling. Seven fields
use at most896 bindings. Fact interpretation, Unicode/path semantics, mutation
invalidation triggers, seal admission, cancellation and the original outer
transaction remain. The shared batch helper loads only during rebuild, retaining
cold retrieval import behavior. No schema, format or semantic producer changes.

A focused fresh database using the original immutable167,936-row input completes
build/checkpoint/close in19.618s; its separate complete validator passes10.703s.
The observed fact-rebuild phase is1.056s. All1,343,488 postings, file identities,
lengths, FTS hits and fact parity remain checked. This observation precedes an
import-only lazy-loading refinement; it is diagnostic repair proof, not final
clean-candidate performance acceptance or a historical wall-clock speedup.

All eight final owner controls pass after formatting: work bounds, exact indexed
fact pages/seals, actual phase/close ownership, bundle/artifact multi-row parity,
metadata/minhash compaction and optional FTS build/compaction. Full qualification
and above-128MiB artifact work remain pending. The original atomic native build
is not partitioned. Earlier successful observations retain their source and do
not become a final-tree campaign pass. Scratch receipts are historical.

The strengthened SQLite latency fixture passes14.5s with both original source
hits required before warm sampling. Its inherited stale trusted-config refusal
is preserved; the isolated fixture now explicitly clears host authority through
the standard test helper. Production admission, queries and threshold remain.
Formatting ran concurrently with this bound, so it is not an isolated latency
comparison. Windows native inspection at158d7fd6e also passes its complete
terminal/index/PTY controls; the fact-writer candidate requires its own acceptance.

All eight publication checks pass, including41 gate cases. The machine receipt
binds final source and native binary hashes. The latency bound records all20
chronological samples and p95=104.3004ms against the unchanged7500ms Windows
threshold; source hits precede sampling. The concurrent formatter prevents any
isolated speedup claim.
