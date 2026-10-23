# Saved retrieval-to-use span evaluation

Status: bounded opt-in source prototype and authored assertions; all unvalidated.
This does not qualify a representative campaign or establish live CLI/MCP/editor
instrumentation. The actual existing evaluation report consumes saved observations.

## Request identity and source conventions

`TASK_SPAN_TRACE_VERSION` and the strict request schema live in
`src/contracts/schemas/task-span-trace.js`. A trace declares task, input, run,
repository, dependent-family, source-generation and query-digest identities plus
an immutable judgment/measurement policy digest. Baseline and candidate runs have
different run/generation keys while a paired task must retain its original input,
query, source-corpus and gold-span identities and measurement rubric.

Each source is repository/mode/relative-file/content-SHA256 qualified. The source
key is computed by `taskTraceSourceKey`; generation-local ordinals never join
sources. One file/mode has one original revision in a trace. Original byte length
is declared separately. Every span uses zero-based, half-open original UTF-8 byte
offsets with an explicit generation. The evaluator does not convert lines,
normalized editor buffers or free-form reads into original-source intervals.
Adapters must supply known original bounds or mark an observation unknown.

Source hashes and lengths are caller-pinned metadata. This evaluator does not
read repository bytes or independently prove that a producer's declared hash or
displayed range is truthful. Exact source-producing adapters must establish that
authority before recording events. It refuses mixed source generations, duplicate
source revisions, invalid gold spans and unsafe relative paths. Wrong-generation,
unavailable-source or out-of-bounds observed events receive no interval credit.

## Separate observations

The four stage states are complete, partial, unknown or omitted. A complete empty
stage is an observed empty set; a missing/partial stage does not authorize a zero
quality estimate. Events retain unique IDs, sequence, adapter origin, original
displayed/truncated span, and optional original retrieval rank. The adapter enum
describes the supplied observation's origin and supplies no independent authority.
Unknown/omitted observations have no invented span. Events after the terminal
sequence remain exported with `after-terminal` and receive no credit, including
late events after cancellation. Duplicate event IDs/sequences are refused.

Retrieved, explored and delivered are independent stages; one never implies the
next. Used requires an explicit claim-to-citation attribution or edit-reference
identifier. A claim attribution must refer to a declared claim and a contained
cited original span. Delivered text, selection, opening or a search hit cannot
infer cognition or use. An edit reference is an observable supplied reference,
not evidence that an edit succeeded.

Intervals are unioned within each original source. Repeated/overlapping/adjacent
ranges receive no double credit. Sources with identical filenames remain distinct
through their full repository/path/content identity. Raw accepted/rejected events
and the metadata-only normalized trace are exported so overlap accounting can be
independently recomputed. There is no source-text or statement-text capture field;
metadata, source hashes and statement digests suffice for this prototype.

## Metrics and atomic citations

For complete runs and complete applicable instrumentation, retrieval overlap,
explored overlap and delivered coverage are original gold bytes covered divided
by original gold-union bytes. Empty/no-gold targets yield null. Claimed utilization
is explicitly attributed used bytes intersecting delivered bytes divided by the
delivered union. It is null when use/delivery instrumentation is incomplete or
the delivered denominator is empty. Observed byte totals from a partial stage
remain labeled partial evidence and do not become complete coverage.

Optional atomic claims retain their raw supported/contradicted/insufficient/unknown
labels and an explicit human/model judge-identity digest. An unjudged claim must
remain unknown. No judge is invoked. Deterministic citation checks run before a
raw support label can receive credit: nonexistent, wrong-generation, missing or
invalid-byte-range citations become a separate `invalid-citation` result. They
never acquire a fabricated human/model insufficiency judgment. A source-valid
merely related citation receives support only if an independently supplied judge
labels it supported. Unknown support remains unknown. The report separately
states whether each valid citation was observed in complete delivered context.

Atomic support rate is available only when every atomic outcome is known; invalid
citations count as deterministic failures and supported known labels count as
support. Otherwise it is null. This does not measure reasoning correctness.
Final task success/failure is a separate explicitly supplied outcome, never
inferred from overlap or citations. Incomplete/failed/timed-out/cancelled runs keep
their raw outcome and stage observations but publish no completed quality metrics.

## Existing evaluation and shared comparisons

An existing dataset entry may carry `taskTrace`, an optional `taskTraceBaseline`,
and optional `taskSpanComparison` fields `metric`, `seed`, `cluster`, `resamples`.
`tools/eval/run.js` adds a separate top-level `taskSpanReplay` after the existing
searches and reports. It remains `currentSearchEvidence:false`; task/gold/claim
labels never reach selectors or search arguments. An absent trace preserves the
default report shape. Malformed optional evidence reports incomplete trace data
while retaining primary judged retrieval results. Mixed query identities or
measurement rubrics are refused rather than combined into apparent parity.

Candidate summaries report repository-macro means and known/missing task counts,
conditional on complete known observations. Baselines use
`compareTaskSpanQuality`, which calls the shared
[paired repository/family quality owner](paired-quality-comparison.md).
Task/source/query/gold identities and the measurement rubric must agree. Failed,
missing, timed-out and cancelled task outcomes remain in paired accounting with
no inferred quality zero. One complete repository/family cluster has no interval.
The metric definition and exact saved run keys participate in comparison identity.
No test-label tuning, success threshold or promotion decision is added.

The comparison adapter captures dense original receipt membership and the own
passive provenance, run-status and selected metric fields before pairing. It
does not invoke receipt accessors, inherited evidence or caller array methods.
The complete flag must be exactly true, and the original run-complete observation
must agree with the declared run status. Original task/input/query/source/gold,
rubric and trace keys are read once as bounded primitive data; later caller
mutation cannot change a run key after its pairing evidence was admitted. The
captured original summaries, including unknown or failed observations, feed the
existing paired-quality owner. Full retained traces and unrelated metadata are
not copied into this small comparison snapshot.

This admission does not authenticate a caller-pinned receipt or independently
revalidate its source bytes or judgments. The actual producer/comparison and
passive receipt controls are authored and **UNVALIDATED**, including accessor,
inherited/sparse/custom-array, changing descriptor and falsey inspection cases.

## Bounds and remaining integration

A trace admits at most1,024 source files,4,096 events,4,096 gold spans,256 claims
and32 citations per claim, with4MiB input,8MiB output,1Mi work units and a
cooperative500ms deadline. Original source files are at most32MiB in declared
length. Sources/events/claims yield in128-row groups. A dataset report admits at
most64 candidate/baseline records,16MiB input/output,4Mi work units and2s. Private
programmatic bounds only tighten; no new runtime config/CLI selector is added.
Cancellation/budget exhaustion returns incomplete output and no metric conclusion
or decision. A256-byte output allowance retains a minimal terminal receipt.
Checkpoint validation binds the normalized complete trace and restarts from zero.
Source/claim machine identities use code-unit ordering instead of host locale;
the versioned trace policy binds this normalization for checkpoint compatibility.

The frozen metadata fixture in `tests/helpers/task-span-trace-fixture.js` and the
focused `task-span-trace-and-quality` and `task-span-primary-report-parity` test
sources cover independently enumerated byte unions, no-gold/unknown use, atomic
wrong-source controls, late cancellation, paired quality and the actual eval
entry's search/report parity. They have not run. Live source-qualified CLI/MCP/
editor event adapters, representative task/real-model labels, source-byte
qualification and broader platform/resource acceptance remain separate work.
