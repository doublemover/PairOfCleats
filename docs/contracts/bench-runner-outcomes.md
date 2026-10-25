# Benchmark runner report version 2

Report version 2 corrects utilization units and adds explicit process/terminal
outcomes. Historical version 1 receipts retain their original interpretation;
they are not rewritten. Benchmark metric log-line syntax is unchanged.

Percentage-named scheduler trace fields contain percentages, including fractional
values and exactly 1. `utilization.overall` is the scheduler's occupied-capacity
ratio and scales by 100. Paired CPU token counters supply a separately qualified
occupancy fallback. Nulls, booleans, strings, nonfinite/out-of-range values and
unpaired counters are unavailable. Measured zero remains a valid value. A valid
lower-priority field may supply the sample when an earlier field is unavailable.

The legacy `perCoreUtilization` report key remains for discovery. Each sample
retains its chosen source, source unit, original value and measurement scope.
The report explicitly states `hardwareCpuMeasurement: false`; scheduler token
occupancy does not prove physical per-core CPU use. Aggregate metrics are null
for absent observations or mixed scopes. Separate scope summaries remain
available. Counts distinguish observed, valid, unavailable, retained and omitted
samples. Retention stays at 2048 samples and a 512-entry timeline. The sampling
window's arithmetic mean and nearest-rank quantiles retain their existing policy.

Each benchmark has exactly one `status`: ok, error, timeout or skipped. Timeout,
signal, spawn/execution failure and nonzero/null exit always retain failure.
`processOk` describes child execution separately from expected metric completion;
`ok` is true only for completed benchmark output. Original exit/signal/failure
facts, missing-output errors and the separately admitted skip reason remain.

A suite entry can skip only with `allowSkip: true`, clean zero-exit execution,
missing expected measurement output and a recognized terminal stdout receipt:

```json
{"schemaVersion":1,"kind":"bench-terminal","status":"skipped","benchmark":"filter-index-build","reason":"roaring-wasm-unavailable"}
```

The receipt must be the final nonempty stdout line, match the selected benchmark
ID, contain exactly these fields and use a bounded reason code. Incidental
skipped/skipping text cannot waive failure or missing metrics. A receipt beside
completed expected output is contradictory and fails. The filter-index optional
backend branch keeps its existing human message and now emits this receipt.
Aggregate counts and runner exit derive from the same terminal status owner.

The runner exposes an internal suite/child injection seam for deterministic
contract fixtures. Real tiny child scripts exercise normal completion, allowed
skip and nonzero/missing-output failures; injected process facts cover signal,
timeout and spawn failure portably. Numerical fixtures independently check low
percentages, ratios, missingness, retained suffixes and summary statistics. These
controls do not qualify a real workload, native backend or measured performance.
