# Finite source-policy qualification

The first #1530 profile independently checks fixed registered policies against
the original #1525 finite source-evidence task runner. It freezes policy, corpus,
metric, subgroup, threshold, fallback, domain and expiry identities before
execution. Its strongest decision is `shadow-only`. It does not fit a model,
establish a statistical selective-risk guarantee or authorize production activation.

The authoritative spec, domain and receipt schemas live in
`src/contracts/schemas/finite-policy-qualification.js`. The offline owner is
`tools/eval/qualification/finite-source.js`; it accepts no command, predictor or
arbitrary metric callback. Candidate methods are the existing visible-source
lexical/order controls and an explicit `always-abstain-v1` negative control.
The abstention control selects no source, performs no source inspection and
retains the uninspected source frontier. Existing source-selecting controls keep
their behavior and identities.

## Frozen execution and independent checking

`freezeFinitePolicyQualification` captures a strict spec. Policy identity excludes
invocation-only run labels; the corpus ID is computed by the same input identity
owner as actual task execution. The first profile requires two distinct fixed
registered policies, matched declared budgets, a complete test-only split and no
fitting. It is limited to eight authored tasks. Original split assignments retain
repository/clone/fix/trajectory/origin/exact-source components; repeating a family
does not create independent support. Required subgroup memberships and thresholds
are fixed before execution.

`evaluateFrozenFinitePolicy` captures the whole source request before awaiting
anything, checks frozen identities and consumes the original plan before running
candidates. Cancellation, budget failure or tool error cannot reset that plan.
It executes the actual cohort and existing paired family-quality comparison.
`qualifyFinitePolicy` reads those original outcomes and independently computes
the deterministic gates; copied reports or caller-supplied aggregate metrics
cannot qualify. Retained original evaluation reports preserve task/scoring IDs,
shared preparation accounting, failures, source-read work and unmeasured costs.
No new annotation, split or statistical estimator authority is introduced.

The plan's single-use control is local to that original owner. Cross-process
holdout exposure, fitted/calibrated policy lineage and persistent independent
checker admission are not qualified by this profile. Recreating a spec does not
make a previously observed holdout unseen. Those limitations prevent this receipt
from granting activation eligibility.

## Separate risk, coverage, utility and cost

Every declared task remains in its population and required subgroups, including
quarantine, tool failures, missing actions and unknown labels. Answered risk is
failures among answered tasks; zero answers gives undefined risk, never zero.
Coverage, abstentions, answered-correct/all, task pass/fail/unknown and newly
incorrect outcomes relative to the baseline remain separate. An all-abstain
control fails the positive coverage floor even if it has no answered errors.

Unknowns produce deterministic identification bounds rather than disappearing
or becoming successful measurements. For n declared tasks, coverage spans
`answered/n` to `(answered+unknownAction)/n`; utility spans `pass/n` to
`(pass+unknownLabel)/n`. For a nonzero answered denominator, selective risk spans
known failures to known failures plus unknown answered labels. Unconditional
failure and unresolved paired harm are reported separately. These are bounds
from missing observations, not sampling confidence intervals.

Each required cohort has its own risk ceiling, coverage/utility floors, minimum
declared leakage-component support and source-read ceiling. A concentrated
subgroup failure rejects even when the aggregate is favorable. Unknown labels
or actions remain insufficient evidence. Source-read accounting records observed
sum/maximum, measured/missing tasks and the declared possible missing-work ceiling.
It measures inspected in-memory source bytes; it does not claim end-to-end
latency, filesystem traffic, RSS, model work or setup/index/training cost.

The existing #1144 paired family-bootstrap report is retained as a diagnostic
quality difference, conditional on complete pairs where applicable. Its interval
is not a selective-risk bound or proof of independence/exchangeability. The
predeclared paired point-difference floor is a deterministic shadow gate.
Statistical risk control, precision, candidate-selection multiplicity, untouched
final holdouts, production utility and complete resource/tail-cost qualification
remain separate work.

## Receipt lifecycle

Decisions are `invalid`, `insufficient-evidence`, `rejected` or `shadow-only`.
Invalid source fixtures stay invalid; successful point estimates cannot override
missing support or subgroup failures. The receipt binds exact candidate/spec,
corpus, original cohort and quality executions, checker/domain identities,
thresholds and immutable observations.

`validateFinitePolicyReceipt` requires the original independent checker receipt,
an exact runtime-domain match and the frozen validity window. A compatible
shadow receipt is usable for shadow inspection only; activation is always
unsupported. Raw historical JSON does not become runtime admission. Model,
filter, vector, feature, source, runtime, resource, oracle or checker mismatch is
stale. `invalidateFinitePolicyReceipt` emits a new status artifact for a changed
named dependency, retaining the original receipt unchanged. Missing/unsupported/
stale receipts require the named fallback through the consuming owner; this
library does not activate or execute it.

Nine authored, locally unrun regressions cover original execution identities,
shared work, the shadow ceiling, subgroup harm, abstention, unknown denominators,
repeated family support, source/spec capture, future-feature rejection, exact
domain/expiry invalidation, failed/quarantined tasks and consumed cancelled plans.
Actual local model/adaptive-trajectory profiles, producer calibration,
cross-run exposure records, durable receipt admission and representative held-out
risk/quality/cost acceptance remain required before closing #1530.
