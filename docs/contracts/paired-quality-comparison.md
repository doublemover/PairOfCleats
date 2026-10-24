# Paired repository quality comparison

Status: source implemented; all new assertions are unvalidated. Representative
quality and runtime qualification remain separately scoped.

`comparePairedQuality` in `src/retrieval/evaluation/paired-quality.js` supplies
one shared quality comparison owner. The strict request contract and canonical
`QUALITY_COMPARISON_VERSION` live in
`src/contracts/schemas/quality-comparison.js`. This source does not implement a
latency estimator, throughput distribution or automatic rollout decision.

## Identity and outcomes

Requests declare an immutable baseline key, candidate key, metric name and
definition digest, seed, resample count, repository/family clustering and slices.
The caller defines quality on the unit interval. Each observation binds a unique
task key, source/query/filter input key, repository, family and slice. The union
of both sides defines the task population. A repeated task is refused; matched
tasks must have identical input, repository, family and slice. A repository must
retain one family assignment across both sides. Caller identities must reflect
the actual immutable source and metric definition; an arbitrary hash alone is
not proof that an external input is trustworthy.

Outcomes are complete, missing, failed, timeout or cancelled. A complete outcome
requires a finite measurement, including a real zero. Other outcomes require
null. An absent side becomes missing. Every task remains in outcome counts,
completion rates and pairing completeness. Up to128 incomplete task identities
are retained per slice, with an explicit omitted count. Unknown outcomes never
become quality zeros. The primitive applies no failure penalty; any future
penalty policy must be declared as a separate metric definition.

## Estimand and uncertainty

The default estimand is the repository-macro mean of per-task candidate minus
baseline quality differences, conditional on complete pairs. Each repository's
paired task differences are averaged first, then repository means receive equal
weight. The task-micro effect is reported separately. Neither result estimates
unobserved task quality, and completion rates are separate from quality effects.

Seeded resampling draws the declared repository or family clusters with
replacement, preserving all paired dependent tasks together. A family draw
retains its repository means and repository count for the macro ratio and its
task sum and count for the micro ratio. Unequal family sizes therefore do not
silently replace repository-macro weighting with family-macro weighting. The
point estimate uses the original complete pairs. The95% interval uses interpolated
percentiles2.5 and97.5 of the seeded cluster resamples. Stable sorting makes
results and checkpoint keys independent of input row order. Identity and cluster
sorting uses UTF-16 code-unit order, independent of host locale. The seeded
xorshift32 stream binds the versioned comparison policy as well as seed, metric
and slice. Its `code-unit.xorshift32.v2` policy invalidates earlier comparison and
fusion-selection checkpoints; changing collation cannot choose different draws.

Each all-tasks or explicitly declared slice reports task, pair, repository and
independent-cluster counts. Fewer than two complete clusters yields a null
interval and `insufficient-independent-clusters`, even with many queries in one
repository. No complete pairs yields null effects. Empty slices retain explicit
zero counts and null completion rates. With incomplete tasks, intervals remain
conditional on the complete pairs and cannot account for missingness bias.
There is no significance flag, threshold selection, multiplicity correction or
non-inferiority decision. Declared slices and tuning policy must be fixed before
locked evaluation; this primitive does not select a winning experiment.

## Bounded ownership and interruption

Admission copies bounded, acyclic plain JSON without executing data accessors.
There are at most4,096 observations per side,16 declared slices,2,048 resamples,
8MiB conservative retained input,1MiB output,2Mi work units and a cooperative1s
deadline. Resampling yields every128 draws. Known limits may only tighten.
Cancellation, byte/work/deadline exhaustion returns `complete:false`, null
estimates/slices and `decision:null`; a minimal terminal form honors the256-byte
minimum output allowance. No partial sample distribution becomes a conclusion.

A checkpoint binds the normalized complete request and versioned statistical
policy. Resume validates that identity and restarts from zero. It does not reuse
interrupted aggregates. Result completeness refers to comparison computation;
`pairingComplete` separately describes the measured population. No latency
inference follows from this quality-only resampling.

## Existing report consumers

`compareVectorOracleQuality` consumes independently produced vector-oracle
receipts with complete source, query, model, generation and cutoff/work-policy
identities. It pairs source/query/filter tasks while preserving distinct exact
model and generation keys on each comparison side. Supported measurements are
ANN candidate recall, ANN top-k recall and original/stored quantization agreement.
Incomplete metric outcomes retain their status. Receipts without required
provenance are refused, including minimal output-overflow receipts. Human-grade
comparison requires independently bound judgment identity and is not inferred
from a vector receipt that lacks that identity. Family clustering requires an
explicit repository-family assignment.

`tools/eval/vector-oracle.js` accepts optional dataset
`vectorQualityComparison` with explicit baseline/candidate indexes into its
already admitted records, plus metric/seed/cluster/families/resamples and tighter
limits or a resume key. It adds `pairedQuality` only when requested. A single
query/repository correctly yields no cluster interval. Multi-repository campaigns
can feed their saved receipt populations directly to the same adapter.

Fusion sweeps preserve legacy descriptive paired-query fields and add
`metrics.clusteredPairedTest` for each held-out metric through this owner. This
happens after the development-selected policy is frozen; test judgments cannot
select it. One sweep currently requires one corpus generation, so its queries
normally supply only one repository cluster and yield null cluster intervals.
The shared metric policy participates in sweep/checkpoint/selection identities.
Saved context-task span reports now consume this owner through
`compareTaskSpanQuality`; they require independently pinned task/input/source/gold
and measurement-rubric identities and retain failed/censored outcomes. The
[task-span contract](task-span-evaluation.md) distinguishes saved observations
from still-pending live instrumentation and source-byte qualification. Existing
descriptive throughput reporting stays with its current owner.
