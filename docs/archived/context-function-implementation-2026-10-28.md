# Complete function context units — 2026-10-28

**Unvalidated source:** `c6ed8a8b9dabed759244a0d029f6568969ddc4b4`, tree
`e042fa56a87c66c978ebd74f7a4fcb2651d3d632`; Windows x64, Node 26.12.1,
branch `codex/pr557-audit-repairs-20261012`. Not pushed or functionally qualified.

#1124 already had versioned task-policy requests, intact whole-file admission,
explicit fallback, source/index identity and surface projection. Its function
route still refused every request unless whole-file fallback was allowed. The
repair adds qualified function units through those same owners.

Function admission reads one contained, bounded UTF-8 snapshot whose full hash
matches the selected index. The existing JS/TS parser family/version owners parse
that same text, including JSX/TSX. Exact callable, export and single-variable
binding associations qualify a unit. Retained definition metadata can qualify a
split fragment only when it exactly matches a parser association and contains
the fragment. Names/containment alone, ambiguous joins, recovery errors, bodyless
declarations and unsupported dialects do not establish a complete patch target.

Complete files retain unit schema version 1. Functions use schema version 2,
carrying original half-open UTF-16 span, full-file source hash/length, parser
identity and an independent SHA-256 of the exact emitted content. Original BOM,
tabs, spaces, Unicode and line endings within the admitted span remain unchanged.
The canonical schema and runtime projection validator reject clipped/mismatched
content, spans, hashes, generations and fallback claims.

Function source reads cap at 1 MiB; traversal caps at 100,000 nodes (and any
smaller requested work allowance), with at most 10,000 queued nodes. Deadline
and cancellation checks are cooperative around the synchronous parse and during
traversal. These are input/work bounds, not measured parser heap/latency limits.
Unsupported/exhausted qualification remains explicit unavailable; only requested
whole-file fallback admits a complete file. A qualified mandatory unit that cannot
fit bytes/tokens rejects without clipping or whitespace rewriting. A small unit
can fit inside a file larger than the response allowance.

Parser imports remain lazy for file/exploration requests. Edit ranges bypass
shared range/excerpt caches, and source verification, selection and slicing use
one snapshot. Historical index roots receive no derived edit cache. Read failure
wrappers preserve exact causes and original resource observations.

Eighteen **unexecuted** `context-pack/complete-function-unit/*` cases cover JS,
TS, JSX, TSX, methods/nesting, split/retained/conflicting associations, malformed
syntax, drift, byte/token overflow, large-file/small-unit admission, source/work
bounds, unsupported languages, cancellation and independent contract negatives.
Existing whole-file, surface, source-lifetime, historical read-only, fidelity and
response-budget checks remain required unchanged. Actual CLI/API/MCP function
positives and supported-runtime/corpus patch outcomes remain qualification work.

Format/ESLint, changed JavaScript syntax, strict composite-schema compilation,
config budget, generated command inventory and whitespace checks pass; shared
module analysis reports zero cycles. No functional fixture, model, child,
benchmark or publication front gate ran. #1125 target-tokenizer accounting and
#1126 bounded evidence selection remain separate implementation work; no quality
or performance improvement is claimed from these authored controls.
