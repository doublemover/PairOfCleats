# Judged evaluation response evidence

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

Additional direct cohort, actual render-budget and actual report-entry controls
are authored and **UNVALIDATED**. No tests, syntax/lint/format, bootstrap, search,
native/child/model execution or quality/performance qualification was run.
