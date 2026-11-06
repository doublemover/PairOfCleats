# Finite source-evidence tasks

The initial #1525 compiler admits authored, in-memory source snapshots under the
closed `finite-source-evidence-v1` profile. It produces visible source manifests,
private interval-coverage oracles, declared lineage, split manifests and typed
task outcomes. [Source-pinned judgments and training cohorts](retrieval-adaptation.md#task-judgments-and-training-cohorts)
reuse these original task/split owners; candidate views still expose no labels.
This supports read-only evidence selection without executing
candidate programs, shell commands, tests or external model providers.
The base-only profile is implemented; history-permitted records remain
quarantined until their own qualified adapter is available.

Source text is captured before use, limited to 128 files, 128 KiB per file and
4 MiB of canonical compiler input. The existing canonical source-identity owner
binds actual UTF-8 bytes, repository namespace, path, language and decoding.
Original UTF-16 boundaries use the existing shared coordinate owner; malformed
Unicode and split surrogate pairs are rejected. Source paths remain canonical.
Known VCS/cache/private-oracle paths or source/task availability beyond the
declared cutoff quarantine the task. Quarantined tasks remain in split/outcome
denominators and cannot expose a candidate packet or become runnable.

The public task identity binds only visible task/specification content and its
source manifest. Private oracle edits invalidate the trusted compilation identity
without changing candidate packets or exposing a digest that could be searched
against a small hidden answer space. The original compiled handle has no oracle
fields. Explicit trusted inspection/scoring APIs own the private data; no
untrusted callback or plugin JavaScript is accepted. This is an in-process
declarative profile, not filesystem/container isolation for arbitrary programs.
Private oracle availability is retained separately, including future reference
labels that must never be copied into visible inputs.

Oracle alternatives form an OR; each alternative's groups form an AND; a group
requires q distinct declared source intervals. Source coverage is computed from
unions of exact candidate spans. Overlap does not multiply source bytes or covered
units. Different sufficient alternatives are accepted. These are benchmark
certificates in the supplied model, not claims that all other solutions are
impossible or that source origins are statistically independent.

Partial/unknown labels cannot turn a missing group or empty label set into a
negative. An explicit verified-empty oracle additionally requires complete
declared coverage and no positive units/alternatives. Unverified or incomplete
oracle premises stay unknown. Invalid source evidence or declared evidence-budget
violations fail separately. Not-run, timeout, cancellation and tool-error outcomes
remain visible with unknown task result. Execution status and task result are
separate axes, and no submitted span is inferred to have been read or used.

`assignEvidenceTaskSplits` freezes up to 64 original compiled tasks under weights
summing to 10,000. Connected declared repository/clone/fix/trajectory/origin/
synthesis ancestry and exact source hashes stay in one split.
Canonical repository namespaces also group together even when supplied family
labels disagree; those labels cannot split one known repository across holdouts.
Compiler digests are reused without hashing source text again. Seeded component assignment
is independent of corpus order and oracle answers. Near-duplicate recall,
below-threshold review, historical exposure and training contamination remain
explicitly unchecked. Equal utility text can conservatively overcluster tasks;
this exact-edge audit is not a contamination-free corpus qualification.

Scoring requires the original split manifest and exact compiled member. Private
oracle or split revisions invalidate prior trusted outcome identities. Candidate
packets omit membership, leakage keys and private hashes. Compilation and split
semantic IDs replay deterministically; separate actual execution IDs retain the
cost of repeated preparation/scoring. Shared preparation is referenced once by
its original execution ID. Source bytes, compilation/split work and score work
remain distinct; unmeasured RSS/build/model work is not reported as a zero.
Outcome semantic IDs identify equivalent judgments. Receipt IDs additionally
bind the actual compilation, split and scoring executions; repeated scoring cannot
collide as one execution or silently erase its additional cost.
Invocation-only run labels stay in actual artifacts and receipts, while stable
candidate-content and corpus identities exclude them. Registered method owners
use those labels only for returned execution provenance; source selection,
budgets, evidence and oracle/split definitions remain bound in semantic identities.
Explicit retirement drops the owner's source/oracle references and rejects later
reads/scoring through that handle. Retirement is idempotent; previously returned
immutable views remain caller-owned. This profile holds no native resources.

## Registered visible-source baselines

The consolidated `tools/eval/adapters.js` registry exposes the finite task profile
alongside the existing offline intervention profiles. Task compilation, split
assignment, candidate-view materialization, bounded reads, candidate execution,
private scoring and retirement use their existing task owners. There is no
arbitrary plugin or command execution and no compatibility registry at the old
`interventions/adapters.js` path: all four prior caller families moved, with their
original fixture IDs and assertions preserved.

A materialized candidate view exposes only its public task identity/profile and
visible packet/source methods. It has no private-oracle/split accessor. The
registered lexical baseline imports only this view capability; changing hidden
labels cannot change its file scores or selected evidence. The separate scorer
can still reject that unchanged candidate. Retiring one view leaves sibling views
and the corpus-owned task intact; retiring the task invalidates later source reads.

The two cheap controls are visible source order and prefix lexical Jaccard. The
latter reuses the existing 4,096-code-unit/128-term feature owner, with exact
surrogate boundaries and conservative source-byte admission before reading.
Inspected prefix bytes, selected whole-source bytes and feature work remain
distinct. Metadata-only selection claims no source read. Uninspected files retain
an exact source-offset/count frontier, without zero scores or a certified ranked
prefix. Both methods obey the declared evidence limits and a 250 ms cooperative
file boundary. They qualify no task model, language behavior or downstream effect.

Three additional unexecuted cases preserve oracle noninterference, an
independently changed oracle rejecting the same baseline, source-order behavior,
candidate/corpus retirement, original handles, Unicode prefix boundaries, source
read budgets, action authority and cancellation. Existing finite-model, origin,
answer-attack and dataset checks retain their coverage through the registry move.

## Shared cohort execution

`tools/eval/tasks/cohort.js` admits up to eight authored tasks and two distinct
candidate methods, under 8 MiB of input. It compiles the whole declared corpus and
assigns one split manifest before any candidate executes. Both methods receive
identical declared budgets and each pair uses the same original compiled source.
An aggregate deadline can refuse a method; it cannot silently tighten one
method's policy while claiming matched budgets.

Every declared task/method remains in the funnel, including malformed semantic
fixtures, quarantine, unrun methods, tool errors and unknown labels. Incomplete
runs do not traverse oracle alternatives. A method's legitimate failure is
separate from execution failure; complete finite evidence checks can reject a
candidate without claiming a program failure. Unreported oversized results remain
explicit unknown entries instead of contributing a passing count.

The runner yields at compilation/candidate boundaries for cancellation. Original
abort errors retain their causes, including falsey reasons, and a bounded partial
denominator with completed/canceled rows. Candidate views and compiled source
owners retire before a successful report publishes; failure/cancellation uses the
same original retirement owners. No native resource, process or filesystem
workspace is created. Repeated runs have distinct execution/receipt identities
while stable input and semantic split identities remain comparable.

Three unexecuted cases cover shared actual preparation, independently rejected
versus accepted controls, repeated execution identity, failed/unknown/quarantined
denominators, original error/cancellation data, capture isolation, matched-budget
admission, bounded output and confirmed owner retirement. This bounded finite
cohort is not a global contamination or production-policy qualification.

## Paired outcome and cost reports

The task adapter lazily exposes `runCohort` and `compareCohort`; callers that only
compile/read tasks do not import the resampling owner. Comparison requires the
original owned cohort and distinct matched-budget methods. It feeds source/task/
oracle/split-qualified observations into the existing paired-quality owner, using
the original leakage component as the family cluster. No second bootstrap or
statistical estimator is introduced.

Known finite-certificate pass/fail outcomes map to one/zero. Unknown labels remain
missing measurements, with complete-pair conditioning and outcome denominators
retained by the existing estimator. Incomplete corpus execution/admission/report
coverage refuses inference over a selected successful subset. Serialized objects
cannot forge original cohort/outcome ownership. Statistical completion does not
qualify a production policy, contamination-free population, semantic source
oracle or executed model/program task.

A read-only work projection counts original compilation/split execution IDs once,
and every actual candidate/scoring execution separately. It reports known phase
time and source bytes, names unmeasured failed-candidate phases and keeps the
whole cohort duration distinct from incomplete phase sums. Missing RSS remains
null; no latency inference is made. Repeated comparison uses the original seeded
family estimator while receiving its own execution identity.

Three unexecuted cases cover exact paired finite effects, original shared-work
counts, seeded replay, unknown labels, incomplete corpus refusal, strict original
identity/method admission, bounded statistics and cancellation. Empirical
production-policy evolution remains outside this authored finite qualification.

Five unexecuted cases exercise private-label noninterference, actual snapshot
immutability, all eight evidence subsets for alternative and q-of requirements,
overlap/contiguous coverage, unknown versus verified-empty labels, failed run
denominators, transitive declared/exact-source leakage groups, corpus-order
replay, future/metadata quarantine, strict source authority, Unicode, budgets,
original handles and cancellation. Actual isolated workspaces, independently
qualified repair/test-log oracles, semantic clone/chronology audit and broader
executed-task/provider campaigns remain separate #1525 work.
