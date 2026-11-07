# Retained graph evidence pages

This experimental source surface remains unqualified. It exposes the existing
retained-family page owner through `pairofcleats graph-evidence --request file.json
[--all]`, `POST /analysis/graph-evidence`, and MCP `graph_evidence` (schema1.8.0).
It changes no existing graph-context, format or authority contract. Canonical
request/result schemas live in `src/contracts/schemas/graph-evidence.js`.

Requests require schemaVersion1, repoRoot, immutable buildId and family
`call_sites` or `graph_relation_edges`. Optional filters are exact identities:
file/callerChunkUid/targetChunkUid/chunkUid/resolution for occurrences, and
graph/from/to/node for resolved edges. Direction out/in requires chunkUid/node;
both is the default. Limits bound rows (1–512), scanRows (1–4096) and total
response bytes (8192–4194304). Defaults are128/1024/1048576. Requests cannot select
an arbitrary index path, change current pointers, enable semantic extraction or
substitute a newer build. Existing canonical repo-cache admission protects reads.

Each result contains exact generation, ordering, cursor scope, rows, scanned
count and row bytes. Empty filtered pages can have a continuation. CLI --all
streams every page with backpressure, including empty pages. Request files are
bounded to64KiB, read as verified regular files and decoded with fatal UTF8.
HTTP and MCP retain their existing authorized-repository and cancellation owners;
HTTP adapters remain lazy so this reader does not enter health/startup work.

`coverage.scope=retained-family` and `coverage.upstream=not-asserted` are explicit.
Completion means this retained enumeration is exhausted. It does not prove
compiler extraction, ambiguity resolution, omitted propagation or whole-program
completeness. Missing or unsupported positioned storage produces unavailable,
never a fabricated empty family. Original integrity failures remain failures.
Stale build/cursor/filter identity is rejected. Existing source refs expose only
already retained qualified source; no current-worktree source is substituted.

Source regressions cover actual retained files, complete cursor chains and
request/authority negatives. Their execution, full transports, native TUI catalog
disposition, generated command inventory refresh, final import budgets and
resource/performance qualification remain deferred. No passing check is implied.

The source repair for #1714 gives a whole row/page enumeration and CLI `--all`
one serial read-session owner. It retains at most one verified JSONL/offset pair,
closes before a shard transition or terminal result, and drains on iterator
return, abort (also while paused between pages), output failure and integrity
failure. Each page still checks the pinned publication before and after reading.
Independent API/MCP/single-page operations open and verify independently; cursors
carry no reader, lease or reusable proof. Small immutable snapshots remain the
exact captured bytes; larger pieces keep their original descriptors and verify
freshly read blocks against the initial complete checksum. Containment/path
identity is rechecked on retained descriptor reads, including atomic replacement.

Decode windows use the existing multi-index row reader and contain at most
32 rows, each at most32768 encoded bytes (at most1MiB encoded temporary input).
They never exceed remaining scan rows or possible output rows. Every admitted
row is schema checked before filtering. A page-byte boundary can discard bounded
decoded overfetch; it does not advance the logical cursor or scanned count past
unconsumed rows. A terminal page/cursor is withheld on failed close. Earlier
streamed nonterminal pages remain a prefix until enumeration/output settles.
Consumers that own a fallible output callback use the existing `consumeJsonRows`
owner to retain both callback failure and independent iterator cleanup failure.

Internal iterator `getDiagnostics()` and row-reader observations report physical
source opens/read calls/bytes, complete-file hash attempts/completions/bytes,
offset entries validated, verified data/offset blocks and block bytes, decoded
rows/windows, maximum encoded decode-window bytes, retained snapshot/proof bytes,
and conservative descriptor bounds. Block proofs count32-byte digests; snapshot
proofs count captured bytes. These are operation counters and declared storage
scopes, not RSS, JS object sizes, metadata I/O totals, end-to-end deadlines or
measured latency. They never enter the strict public result schema. The authored
enumeration and extended producer/CLI fixture are unrun; existing canonical,
authority and falsey/frozen cleanup controls are retained.
