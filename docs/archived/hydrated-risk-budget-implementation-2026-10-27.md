# Hydrated risk-flow budgets — 2026-10-27

Source `9d5f6c8bea42d81b8af5bf73b90ba8fc46cda669`, tree
`c6edecfdb1dded50b8d5b3faf31def490cc7da2d`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.
Unpublished; functional qualification remains deferred.

The existing selector admitted skeletons with null call-site details, then inserted
hydrated metadata/excerpts without rechecking family byte/token caps. Its counters
still described the smaller skeleton. Final admission now measures complete
hydrated ranked units, with exact emitted compact JSON array bytes and the existing
serialized-risk token estimator. Array brackets/separators are included; active
empty arrays are two bytes/zero estimated tokens. Selected/omitted totals reconcile,
and emitted step counts come from retained full flows.

Metadata is checked first against the remaining allowance after earlier fully
hydrated units. A provably oversized candidate therefore requests no source
excerpt. Initial discarded skeletons never return through backfill; frontier-only
IDs with no emitted detail slot no longer trigger unused hydration. Only admitted
detail slots use the existing bounded source context, with shared call-site reuse.
If subsequent excerpts/provenance overflow, the entire candidate is omitted rather
than presenting incomplete metadata as a complete flow. Work on a provisionally
admitted candidate is separate from final output admission.

Bounded compact-JSON measurement rejects oversized strings before encoding them
and charges repeated evidence at every position. It does not build a potentially
huge repeated hydrated envelope just to discover it exceeds 24/16 KiB. Accepted
counts are exact; rejected counts can be explicit lower bounds. The serializer
uses ordinary data descriptors and bounded work, propagating measurement errors
instead of hiding them as unavailable call-site evidence. Ranking/ties, independent
flow/step/site limits, original byte/token caps, strict behavior and the complete
128 KiB response guard remain. No public knob/schema relaxation or target-model
tokenizer claim is added. Existing estimator exports remain as independent oracles.

Seven cases are authored, **unexecuted**: JSON encoding parity (including escapes,
Unicode, lone surrogates, omitted values and repeated objects), pre-encoding refusal,
exact/over/token limits, full/partial oversized metadata with zero source reads,
aggregate hydrated evidence and deterministic IDs, actual assembly at the exact
byte cap and an admitted source-read positive. New artifact call-site IDs use the
authoritative SHA-1 form. Existing ranking, truncation, strict-risk, federation,
serialization-reuse and complete-response assertions were preserved.

Format/ESLint, changed-JavaScript syntax, config budget, script inventory and
whitespace checks passed; shared-module analysis found zero cycles. No project
functional fixture or benchmark ran. #131 remains open for complete original and
follow-up acceptance. Task-unit, target-tokenizer and generic evidence-selection
enhancements remain separate. See the [contract](../contracts/hydrated-risk-admission.md).
