# Run a bounded benchmark

Use the supported Node 26.12.1 checkout with verified bootstrap. Benchmarks are
scoped experiments; ordinary implementation starts with affected regressions and
the [contributor front gate](../guides/contributing.md).

## Select inputs, outputs and effects first

Read the chosen benchmark owner's help before running it. Select a tiny disposable
fixture, exact mode/backend, jobs and timeout, an explicit output path and the
owner's cache/input location. Language-repository campaigns can clone/download
sources and build indexes; they need explicit task scope. Do not start a full
index, native crash investigation or release campaign as a routine check.

The current language CLI derives its root from the product cache owner under
`bench-language`, with selected mode/suffix inputs; do not assume the old
`benchmarks/cache/repos/<repo-id>` path. Developer fixture workspaces use
`.tmp/dev/benchmarks`. Preserve result/evidence files separately, inspect active
owners before cleanup and never remove user indexes/caches as generic preparation.

## Choose the experiment

- Component microbenchmarks: inspect `tools/bench/micro/` owners and their supported
  selectors; keep input size and repetitions bounded.
- Language repository runs: use `node tools/bench/language-repos.js --help`, then
  explicitly select fixture/repos, mode, backends and outputs. Review any clone,
  build, acquisition or cleanup effects before execution.
- Embedding comparisons: follow [the bakeoff](embedding-model-bakeoff.md); direct
  source invocations are not invented npm aliases. Model acquisition and real
  inference require their own explicit scope and compatibility evidence.
- Throughput reports: use the existing report owner with one selected baseline,
  mode and output. Missing latency/memory/rate remains unknown, including JSON/CSV.

## Interpret the evidence

Record exact head, Node/native/runtime identities, platform/architecture, selected
repo revision, commands, outputs, failures and unrun prerequisites. Distinguish
stub/real vectors, sparse/dense candidate stages, sampled/full runs and process
warm/cold state from filesystem cache state. An unavailable backend or unexercised
provider is not successful evidence. Keep input and work semantics compatible
across comparisons; do not promote a microbenchmark into a workload recommendation.

Stop/report tests over 30 seconds; do not turn retries, skips or longer deadlines
into acceptance. Broader benchmark runtime is permitted only when the experiment
is explicitly scoped and its own deadlines/cleanup ownership are defined.
The [qualification matrix](../testing/qualification-matrix.md) defines evidence
classes and [profiling](profiling.md) covers bounded diagnosis.
The [benchmark runner report contract](../contracts/bench-runner-outcomes.md)
defines version 2 utilization units/scopes and the process facts required for an
allowed terminal skip. Missing utilization is unknown, not a measured zero.
The [A/B sweep admission contract](../contracts/benchmark-sweep-admission.md)
defines completed-work and knob-consumption evidence, the version 2 objective,
immutable raw reports and bounded invocation storage. Unqualified variants remain
visible and cannot produce a recommendation.
The [evidence retention contract](../contracts/benchmark-evidence-retention.md)
defines capacity admission and protects paths issued by saved reports or resume
checkpoints while retiring only old, settled, unreferenced invocation files.
The [throughput input contract](../contracts/throughput-result-admission.md)
defines supported result envelopes, bounded selection, partial cohorts and the
complete input receipts required before report comparisons.
The [remediation evidence contract](../contracts/benchmark-remediation-evidence.md)
distinguishes nonempty-result frequency from judged target outcomes, service
elapsed time from batch wall cost, and inspection hypotheses from qualified
production changes. Workload changes require independent holdout qualification.
The [SQLite workload contract](../contracts/sqlite-benchmark-workloads.md) defines
current snapshot admission and content validation for the build/update smoke
benchmarks; larger repeated workload qualification remains separate.
The [search microbenchmark contract](../contracts/search-microbenchmark-evidence.md)
defines retrieval/cache work modes, observed work and model receipts, frozen query
schedules and the controls required before baseline deltas or ANN ratios.

The complete previous guide, including original usage tables and dated repair
narratives, remains in [the historical snapshot](../archived/benchmarks-overview-2026-10-22.md).
Its paths/counts/platform results retain their original provenance; they are not
current-head measured performance. This editorial revision is **UNVALIDATED**.
