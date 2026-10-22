# Judged evaluation response evidence

Selected dataset cases are admitted before the first search. Each requires a
nonempty query string. Every explicitly present `relevant`, legacy `expect` and
`gold` field must be a dense passive array of valid judgment rows. Null, falsey,
malformed, inherited and accessor containers cannot disappear into unjudged
metrics. Valid explicit empty `relevant` retains precedence over a valid legacy
alias; absent labels remain unjudged. Queries, modes and scalar label snapshots
are captured before asynchronous search work. Invalid/empty datasets throw inside
the existing resource scope so cache/display cleanup precedes failure propagation.
Dataset, actual runner/no-search and legacy-alias controls are authored and
**UNVALIDATED**; whole dataset memory, source provenance and real retrieval quality
remain separate qualifications.

The evaluation runner scores each selected result cohort separately. A selected
cohort must be an explicitly present array of actual hit objects. An empty array
is a genuine observed zero-hit result; missing/null/malformed cohorts, sparse hit
arrays and failed/missing response envelopes do not authorize zero-quality
metrics. The primary report rejects those responses before publishing metrics.

The existing retrieval renderer may compact metadata and then remove tail hits
to satisfy its output byte budget. Its `outputBudget` receipt must explicitly
report zero omitted hits before judged evaluation can consume a budgeted output.
Known hit removal, contradictory or missing retention evidence is unavailable
evaluation input. A global omission receipt does not identify which cohort lost
hits, so the evaluator cannot infer that another selected cohort was complete.
Metadata compaction with explicit zero omissions preserves the existing match
fields and is admitted. The evaluation runner does not bypass a configured byte
budget or invent missing candidate membership.

Combined-mode relevance remains mode qualified and macro averaged across judged
cohorts; the evaluator never concatenates incomparable score spaces. Genuine
zero hits still score zero for supplied relevance judgments. This contract does
not assign a quality penalty to failed retrieval, infer a failure score, change
judgments or promote saved replay into current-search evidence.

Judgment rows also require explicit supported evidence. Each must provide at
least one own scalar nonempty `file`, `name` or `kind` predicate. An empty object,
unsupported-only row, inherited/accessor predicate or falsey explicit matching
field cannot become an unrestricted match. Explicit `mode` must be one canonical
cohort, even in a single-cohort dataset. Combined-mode labels still require that
mode; filtering never turns an invalid explicit mode into an unqualified label.
The cohort and metric consumers use the same frozen scalar predicate snapshots,
and additional metadata does not become matching evidence. Existing exact file,
case-folded name/kind and substring/exact matching policies remain in place.

Judged document assignment requires an observed stable chunk or file/range
identity. A rank-local ordinal cannot prove distinct documents and cannot supply
additional relevant slots. Unknown identity makes judged input unavailable;
unjudged cohorts remain unjudged. Every rank slot must be an own positive integer,
with no sparse/inherited entries or duplicate ranks. Missing rank data cannot
serialize as a successful `NaN`/null quality metric. These rules reject malformed
evidence without inventing judgments or a failure penalty.

Additional direct judgment/cohort/matcher/metric, actual render-budget and report-entry controls
are authored and **UNVALIDATED**. No tests, syntax/lint/format, bootstrap, search,
native/child/model execution or quality/performance qualification was run.
