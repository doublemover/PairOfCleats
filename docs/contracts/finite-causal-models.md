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
Counterfactual prediction, compatibility and action discrimination are subsequent
consumers of this evaluator, not implicit consequences of creating a model.
