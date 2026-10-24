# API contract report outcomes and diagnostics

The API-contract CLI uses the same validated report path for successful analysis
and `ERR_API_CONTRACT_WARN`. The pure builder retains its throwing contract.
The shared report-outcome owner recovers only that explicit attached-report
failure, validates the report, writes an explicitly requested artifact with the
existing atomic writer, then emits the requested report once and rethrows the
original policy exception. Fail-on-warning still exits 2, including zero-detail
caps. Successful reports still exit 0.

JSON stdout contains the schema-valid report, without added prose or an
outcome envelope. The subsequent [parameter handoff](api-callable-parameter-handoff.md)
advances the report to 1.1.0 for its explicit formal-parameter qualification. The concise policy summary remains on stderr. Markdown
uses the same report renderer on success or policy failure. `--emitArtifact`
writes the same `api_contracts.jsonl` symbol rows for either analyzed outcome.
Load, schema, internal and artifact-write failures remain ordinary exit-1
failures; they do not emit a completed policy report. Requested artifact writes
precede stdout, so a failed artifact write cannot claim completed publication.

Human reports retain warning codes/messages even when export selection leaves
no symbols. Global/per-symbol copies are deduplicated by canonical warning
identity. One linear projection indexes only retained warning navigation needs
across the retained calls; a three-call display preview cannot hide a mismatch
on a later retained call. Diagnostics include symbol/call IDs, available
file:line/column, recorded target qualification and generation. Missing or
ambiguous joins/coordinates remain unavailable; foreign generation/target data
cannot borrow current coordinates. These are navigation witnesses, not edit
authority. Arity and expected/observed messages retain their producer's meaning;
the renderer does not recompute arity from argument previews.

Human output shows at most 100 warning details, 100 symbols and three call
previews per displayed symbol, with text bounds and explicit omissions. These
presentation bounds do not alter structured report evidence, detection totals,
warning retention caps, source selection, or enforcing outcomes. Zero-warning-
detail reports retain their detected/retained/omitted count summary.

Authored, unrun checks extend the existing real-index zero-cap and export CLI
fixtures: exit 2 plus valid JSON/identities/coordinates, zero retained detail,
explicit artifact content, and a genuine artifact-write failure control. The
builder/Markdown/outcome fixture covers a fourth mismatched call, two source
lines, missing coordinates, filtered legacy export identity, de-duplication,
human caps, generation mismatch, ordinary/schema failures and frozen original
policy exceptions. Existing clean controls remain. Runtime qualification is
deferred to the requested validation phase.
