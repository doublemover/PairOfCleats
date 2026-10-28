# Exact rendered token-budget implementation — 2026-10-28

Source `a512377128207026a75097aceb811f6d2f6a6409`, tree
`2087544356910eb8b5dabb077341b18fb09fafbb`, on
`codex/pr557-audit-repairs-20261012`. Unpublished; no functional acceptance claimed.

#1125 now has an optional, strict versioned local tokenizer profile and exact
rendered-token allowance across CLI/HTTP/MCP. The actual selected repository
owns two fixed contained-file inputs, with bounded descriptor reads and pinned
SHA-256 identities. The public pure JS tokenizer engine is versioned separately
from the caller-declared model/revision. Its existing locked version, 0.2.0, was
promoted to a direct dependency; all existing package resolutions/integrities
remain unchanged. No model execution/download or transformer runtime is loaded
for counting. Absent preserves existing behavior.

The supported `context-text-v1` envelope is the actual text rendering plus one
final newline. It includes rendered labels, provenance, delimiters and intact
source; additional JSON-only records, JSON/SARIF decoration, the receipt and
unseen caller prompts/wrappers are explicitly excluded. Declared overhead is
reserved independently. Counted source cannot be clipped or pruned afterward.
Final native and decorated CLI JSON must independently fit the unchanged
128 KiB limit. Exact overflow, invalid/unknown profiles and unavailable bounded
counting fail explicitly through existing canonical error surfaces.

Existing PQueue, scheduler lease, IndexerThreadPool, worker heap contract,
contained-file and pool destruction owners provide admission and lifecycle.
Only serialized queue admission lends CPU; active worker execution retains the
actual task permit through original teardown. One active worker/four admitted
calls, bounded input/structural/encoding work, generation heap limits and a
10-second count deadline constrain work. Parent heap incompatibility has no
inline fallback. Unknown original descriptor/worker settlement remains retained
and blocks further work; timeout/crash retries cannot produce acceptance.

At most 512 hashed scalar counts are retained, without tokenizer/source objects.
Keys include exact text, actual tokenizer/config hashes, engine/revision,
rendering and task/budget policy. Local input identities are reverified even on
hits. Only successful fit, validation, uncancelled admission and confirmed worker
exit publish counts. Payload/text/receipt identities have runtime projection
checks; accounting and rendered text are paired in the authoritative schema.

Twenty-five authored cases await execution: twenty exact-count/profile/content/
budget/cache/authority/cancellation/receipt controls and five actual CLI/HTTP/MCP/
invalid/overflow surface controls. Fixtures include intact parser-qualified
function source, Unicode/CRLF and hand-enumerated word controls. The reviewed
optional JSON flag advances the CLI governance budget from 77 to 78, with no
configuration key/environment variable. Generated contracts/inventories were
refreshed from their owners.

Static format/ESLint, changed JavaScript syntax, strict response/request schema
compilation, config budget, generated command inventory and whitespace checks
passed. Shared-module analysis found zero cycles. No functional fixture, child
fixture, server, benchmark or publication front gate ran during this source wave.

The changed dependency inputs required a real `npm run bootstrap:ci`; it exited
0 on Windows x64, Node 26.12.1, ABI 147, verifying 37 required packages, 33 language
routes and 8 patch packages / 26 targets / 61 hunks. Its entire 21,384-byte log
contains zero warning/error/failure matches. Manifest SHA-256:
`ab4c2f155a61809be3dad5f4ae75c35ff74d4f30f34cc13f280cb7463e0718fd`;
lockfile `8cf51352b92b21f18bf54b3cafb3ec5eb2e9f061a01be57d728d67e1953baf96`;
log `adc2a9f7609e5806f433111fb2cc14378dd7ad095a802ed7dc7e035985dbeeb9`.
The author-workspace log at `.tmp/tasks/context-token-budget-20261028/bootstrap-ci.log`
is historical local evidence, unavailable in a clean checkout. Setup readiness
does not qualify the new runtime path. Full profile/cancellation/original-owner/
surface and original/follow-up acceptance, serial cold/warm counting/assembly
measurements and corpus qualification remain. #1126 set selection is separate
source work; no speed or model-quality claim is made and #1125 remains open.
