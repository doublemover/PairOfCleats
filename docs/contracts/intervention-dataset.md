# Offline intervention dataset reports

Existing `tools/eval/run.js` dataset cases can explicitly carry
`interventionEvidence`: a version-1 record containing the trimmed query's SHA-256
digest and up to eight uniquely identified trials. The closed trial profiles are
`finite-lookup-v1` (model plus intervention specification), `origin-observation-v1`
(saved trace/lineage input), and `retained-answer-integrity-v1` (historical revision
plus named attack cases). Their authoritative input schemas live under
`src/contracts/schemas/`; arbitrary execution callbacks/profiles are rejected.

Optional containers are captured before search and before asynchronous schema
loading. Ordinary datasets do not load or compile these optional schemas.
The selected adapter alone is imported when a trial executes. Captured trials are
never passed to search, scoring, cohort selection or current retrieval identity.
Reports retain the existing live metrics and add only `interventionEvaluation`,
with `currentSearchEvidence: false` and no policy-qualification/task-success claim.

Known malformed optional data remains a refused input row. A wrong query digest,
duplicate local trial ID or origin trace tied to a different query is refused
before adapter execution. Model/table or other profile contract errors remain
explicit refused-profile rows. Unexpected setup/introspection exceptions propagate;
they are not retried, replaced by another executor or erased as missing metadata.
An incomplete profile or refused input cannot produce a complete report.

Admission caps the captured section at 8 MiB, 64 selected cases and 32 aggregate
trials. Evaluation runs serially under a maximum one-second aggregate allowance,
with up to 250 ms per bounded profile and a 1 MiB output limit. Imports/preparation
consume the trial allowance. Exhaustion preserves checked rows, remaining trial
identities and actual work for an evaluated result that could not fit. No omitted
payload is counted as an evaluated success. A caller may tighten these internal
allowances; there are no new CLI/config/environment knobs.

Each finite-model receipt retains task/split identities, actual realization and
separate work. Origin/trace reports retain unknown instrumentation and dependence
assumptions. Answer attacks keep historical integrity separate from current source
admission. These are useful independent report axes; they are not averaged into a
trust/causal score. Held-out policy evaluation, semantic source-support checking,
real task execution and provider qualification remain separate acceptance.

Three unexecuted cases cover all explicit profiles, immutable pre-search capture,
wrong/unsupported/duplicate records, original inspection errors, profile refusals,
bounded reporting and cancellation. The existing real report-entry parity fixture
also compares default, optional and refused runs, requiring identical actual
search arguments, live identities and primary quality summaries.
