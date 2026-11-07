# Benchmark progress confidence observations

Progress-confidence version 2 is an observation heuristic, not a calibrated
probability, proof of useful work or watchdog decision. Its thresholds and
component weights remain unchanged. Only eligible components enter weighting:
a completed positive heartbeat interval, two queue-age observations, two
in-flight observations, or a stall observation/opportunity. An unobserved
no-stall default has no weight. A task-start alone cannot supply an interval.
Silent children, ordinary text and absent/null telemetry remain unknown.

Components retain their observed score, eligible score, sample count, required
minimum and eligibility. Coverage exposes the participating components and
weight. Zero remains a legitimate observed score; null, booleans, strings and
nonfinite scores/sample counts cannot manufacture measurement. Existing partial
telemetry remains useful when its participating components have actual samples.

Each process summary and JSONL row records a last-observed snapshot: first and
last observation bounds, snapshot time, current age, the existing 30-second
heartbeat threshold and last observed phase/task context. Component arrays retain
their existing bounded trailing samples; process observation bounds do not claim
every component shares one exact retained interval. Historical component score
remains available as `sampleScore`. Insufficient, stale or unknown-age evidence
has no current numeric score and uses bucket unknown. Fresh observations can
restore an observed score; ordinary bytes cannot refresh that evidence clock.

Interactive output labels this as a last-observed heuristic and includes its age.
Snapshots are produced by the existing event/stall/exit flow. There is no new
refresh timer or competing timeout policy, and a past displayed snapshot does
not claim continuously refreshed liveness. Existing watchdog/activity clocks and
cleanup ownership retain their behavior.

Replay uses the same primitive finite-or-unknown score admission. Current rows
also need observed freshness and reproducible eligible component evidence.
Historical rows remain readable as recorded heuristics. Unknown/stale rows stay
in event and bucket coverage but not numeric average/min/max denominators or
ranked measured details. `scoreCoverage` exposes observed and unknown counts.
Actual numeric zero remains in the denominator. Execution identity participates
in copy matching, and latest rows retain observation state and age.

The pure weighted-score positives retain their formulas and expected values.
New deterministic clock controls cover healthy observation, silence, recovery,
reversed clocks, insufficient samples and primitive admission. Real tiny process
controls add silent, ordinary, null-field and start-only children, checking both
returned summaries and persisted rows. JSONL controls verify null beside 0.8,
real zero, typed invalid scores, stale/current evidence and exact mirrors.
Functional execution is deferred with the current implementation wave.
