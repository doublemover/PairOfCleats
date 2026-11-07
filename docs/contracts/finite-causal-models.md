# Finite causal hypotheses

The #1524 workbench admits explicit finite models for comparison. The initial
evaluator accepts acyclic deterministic lookup equations, with one total equation
per endogenous variable, none per exogenous variable and an explicit finite
exogenous support. It computes the supplied model's consequences. Source,
observation and model evidence retain distinct input partitions; neither source
bindings nor a model's own assumption statuses certify causal truth.

A world binds the canonical source generation, build/runtime identities, optional
trace run/schema, phase, unit definition, coverage contract and observation
contract. Variable domains contain explicit uniformly typed Boolean, safe-integer
or string values, operational-definition identities and supplied UTF-16 source
bindings. Missingness can be a declared modeled value; an unknown analysis result
is not silently inserted into the domain.

Models are limited to 1 MiB of canonical input, 32 variables, eight values per
domain, eight parents and 256 complete rows per equation, and 256 unique support
assignments. Each assignment binds every exogenous variable exactly once. Cycles,
missing equations, incomplete/duplicate lookup rows, invalid types/references,
arbitrary executable callbacks and undeclared interventions are rejected. Feedback
requires a separate declared semantics; deleting an inconvenient edge cannot
qualify it.

Unweighted support has no implied distribution. Optional nonnegative exact
rational weights require a complete declared support and sum exactly to one.
There is no floating-point normalization or invented uniform prior. Rational
operations retain reduced BigInts with a separate 4,096-bit allowance. Encoded
input numerators/denominators are bounded to 64 decimal digits. Zero denominator,
negative mass, mixed weighting and partial normalized distributions are rejected.

`evaluateFiniteCausalModel` uses an assignment in the original model's support and
an admitted constant intervention. The intervention replaces the named mechanism;
all other descendants recompute in topological order under that same exogenous
assignment. It is not observational conditioning. The immutable valuation retains
each lookup/intervention step and operational definition, with an explicit
model-only qualification. Evaluation never runs source, applies edits or starts
an experiment. Its output is limited to 128 KiB.

Private model handles own captured, frozen JSON and compiled tables. Full
equations, support, weights, definitions, assumptions, evidence partitions, world
and evaluator version participate in the identity. Copies cannot act as compiled
handles. Capture, validation, identity, retained-input and evaluation work are
reported separately from semantic identity; no runtime performance qualification
is claimed.

Four unexecuted cases cover all 1,152 assignments/interventions over 64 small
Boolean DAGs against an independent simultaneous-valuation oracle, mixed typed
variables, descendant recomputation, exact weights, malformed/cyclic models,
support/domain errors, immutability, source/run identity and cancellation.

## Factual-conditioned prediction and compatibility

`createFiniteCausalPredictionService` filters original exogenous assignments by
explicit supplied factual values, then applies the intervention to those same
assignments. Query model/world/question and every operational definition must
match. Unavailable evidence cannot carry filtering values. The exact weighted
conditioning mass is accumulated separately; zero support and zero conditioning
mass remain distinct unresolved premises, without fabricated probabilities.

Pages admit at most 256 assignments, 32 outcome updates, 250 ms of cooperative
work and 128 KiB of wire JSON. The owned cumulative outcome set is limited to
2 MiB; the shared semantic continuation budget charges 16 MiB per retained cursor
for model, compiled data and snapshot state. Old cursor replay forks the original
checked prefix. Changed evidence, intervention, definitions, world or task/
branch/assumptions cannot resume it. Deferred publication, failed serialization,
cancellation, TTL/count/byte eviction and disposal reuse the existing page and
retention owners. No native reader or experiment is retained.

Wire pages contain updates to the cumulative outcome set; each outcome retains
the number of original assignments, its unnormalized mass when weighted and one
support-index/valuation witness. `projectFiniteCausalOutcomes` pages the immutable
owned cumulative set, including probabilities available only after complete
positive-mass conditioning. Partial traversal or unknown additional support never
establishes an exclusion. Serialized pages cannot forge owned completion receipts.

`compareFiniteCausalEvidence` requires the original prediction and an exactly
scoped, fully defined outcome tuple. Inclusion establishes compatibility only.
Exclusion from a complete finite prediction contradicts that declared model under
the supplied premises. An absence claim additionally requires complete
instrumentation/window coverage; missing instrumentation is not a missing event.
Observation receipt IDs remain supplied metadata until an external owner admits
them. This pure comparison cannot certify causal direction or eliminate a live
investigation hypothesis automatically.

An internal factorized parity path traverses sums of original support occurrences
through the existing factor-relation owner. Physical sum paths carry no extra
assignment count or probability mass. It charges construction and traversal on
every page and makes no optimization claim. Both paths use the identical model,
question and evaluation semantics; model preparation and actual equation steps
remain visible in work receipts.

Five additional unexecuted cases cover common-cause versus direct models,
factual counterfactuals versus resampling, collider conditioning, exact rational
mass/zero mass, incomplete support, missing instrumentation, 64-assignment flat/
factorized parity, assignment counts, stale scopes, bounded private cursors,
output failure and cancellation. Statistical/learned identification remains
unqualified and disabled.

## Inert discrimination advice

`planFiniteCausalDiscrimination` compares up to eight supplied models and eight
supplied actions using original owned prediction receipts. Every query must match
the model, world, operational definitions, factual conditions, intervention and
task/branch/assumption revision. Missing/incomplete predictions survive every
outcome, including the unknown-outcome bucket. Complete overlapping prediction
sets remain overlapping; an arbitrary representative cannot turn them into
disjoint partitions or create false model eliminations.

Advice minimizes the worst-case surviving model count, then the declared action
plus proof cost, then stable action ID. Tied alternatives, prediction references,
unknown survivors, worst-case witnesses and residual ambiguity remain explicit.
This is a minimax choice among the supplied candidates and declared costs; the
model/action candidate sets need not be exhaustive. A 250 ms cooperative action
boundary leaves unchecked action IDs and unresolved optimality when exhausted.
The advice packet remains under 128 KiB and does not retain expanded prediction
snapshots. Prediction construction/traversal/evaluation work remains charged by
the referenced receipts rather than disappearing from a performance comparison.

An action requires explicit finite-model admissibility and supplied receipt IDs;
every model must admit the intervention. Held-fixed requirements need a complete
joint prediction containing the named variables and satisfying those values.
Descendants cannot be frozen implicitly. A hypothetical declaration grants no
permission to run an experiment, edit source or upload traces.

`planInvestigationCausalEvidence` binds an original plan to the exact existing
investigation and projection revision. It hands only matching, independently
owner-admitted read actions to the existing next-evidence advisor. Source-inspected
requirements retain their actual source roles; a model consequence does not
satisfy them. Stale plans, changed branches/assumptions/worlds and execution-class
actions fail the existing boundaries. The seam adds no observations or support.
[Paired finite-model replay](paired-finite-interventions.md) records realized
mechanism replacements under #1526. Actual source/experiment realization and
telemetry admission remain separate qualifications.

Five unexecuted cases cover common-cause/direct minimax and stable ties,
mediator interventions versus unavailable actions, explicit held-fixed rejection,
compensating mechanisms versus no effect under nondiscriminating actions,
an independent Boolean-outcome oracle over every subset of unknown predictions,
incomplete overlapping outcomes and current-revision read-only investigation
handoff. No causal identification or experiment execution is claimed.
