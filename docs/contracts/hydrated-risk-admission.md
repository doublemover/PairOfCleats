# Hydrated risk-flow admission

Risk-pack ranking, maximum flow/step/call-site counts and the existing full/partial
byte/token caps remain unchanged. Initial skeleton selection bounds candidate
work; rejected candidates never return through a later hydration/backfill pass.

Each selected candidate first receives normalized call-site metadata, without
source reads. This is a lower bound on its hydrated output. Admission checks it
against the allowance remaining after earlier fully hydrated units in rank order.
Only an admitted metadata candidate may request its call-site excerpts. Shared
call sites reuse the same bounded source context and hydrated result. Frontier-only
IDs that have no emitted detail slot do not request unused hydration.

The complete hydrated unit is then checked again. If excerpts or provenance push
it beyond the remaining family allowance, that whole unit is omitted; its partial
metadata is not presented as a complete flow. Work spent on a provisionally admitted
candidate remains bounded separately from final output admission. Measurement
errors propagate instead of being downgraded into missing call-site evidence.

Compact JSON admission bounds encoding before large strings are materialized.
Repeated metadata is counted at each emitted position, including shared objects;
accessors, cycles and non-plain payloads cannot run custom serialization. Accepted
byte counts are exact UTF-8 `JSON.stringify` sizes. Rejected units may retain an
explicit lower bound instead of building an arbitrarily large encoded string.
Token counts use the existing serialized-risk regular-expression estimator,
stopping after an exceeded limit. These are not target-model tokenizer counts.

`caps.observed.bytes/tokens` describe exactly the final `flows` array, and
`partialBytes/partialTokens` describe the final `partialFlows` array, including
array brackets/separators. Active empty arrays therefore use two bytes and zero
estimated tokens. Selected/omitted counts reconcile with ranked candidates;
emitted step counts describe retained full flows. Truncation uses the existing
cap names and explains admission stage/rank and lower-bound measurements. The
independent 128 KiB complete-response guard and strict risk/evidence behavior stay.

Seven cases are authored and unexecuted: bounded JSON parity/encoding refusal,
exact/over/token limits, full and partial oversized metadata without source reads,
aggregate hydrated detail with deterministic retained IDs, actual assembly at the
exact byte limit and an admitted positive source-read control. Existing ranking,
truncation, strictness, federation and whole-response coverage remains required.
Target-tokenizer/task-unit and evidence-selection enhancements remain separate.
