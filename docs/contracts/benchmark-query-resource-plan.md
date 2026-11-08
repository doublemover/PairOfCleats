# Benchmark query resource plan

`--query-concurrency` is a global limit for the benchmark invocation. One
versioned `bench-query-resource-plan` admits every selected query backend against
one allowance of 40% of reported host memory, retaining the existing 512 MiB
minimum estimate budget. Artifact-size heuristics remain estimates, not RSS
limits. The plan reports per-class worker estimates, concurrent peak estimate,
global planned capacity and each stage's allocation.

`memory` is one resource class. `sqlite`, `sqlite-fts` and `fts` retain distinct
requested workloads while sharing the SQLite resource class. That class is
serialized and retires its process after every query. Memory workers retain their
cache only within their stage. Minimum-one-per-class allocation cannot exceed the
global concurrency or shared memory estimate: when simultaneous admission does
not fit, classes run in separate stages. Every stage closes before the next pool
is allocated. A required single worker larger than the estimate allowance is an
explicit unsupported plan; it does not silently omit that backend or force an
oversize worker. Existing empty-mode admission still owns legitimate exclusions.

The caller reuses the existing grouped worker pool and concurrency queue. A
worker stays busy through awaited process retirement, so another completion
cannot pump a replacement process while its predecessor is closing. Existing
generation-bound callbacks, queued-close settlement and cancellation owners stay
in place. Each requested backend/query occurrence retains its coverage receipt.

`queryConcurrency` reports global planned capacity. `queryWorkerPlan` retains the
allocation and retirement assumptions. `queryWorkerObservation` separately records
submitted/completed/failed tasks, reservations (including pool-queued work),
running-query counts, live-worker peak and per-backend observations. Start,
heartbeat and completion samples include short queries. Sampled RSS covers the
benchmark parent and known query-worker processes, including idle/retiring workers
until their close event. Missing samples remain explicit. It is neither an
instantaneous hard maximum nor a measurement of arbitrary nested descendants;
`processTreeRssPeakBytes` remains null and descendant coverage unavailable. Whole
process-tree memory qualification needs an additional measurement owner.

Authored tests invoke the actual benchmark entry/reducers with named inert
artifact/search adapters, covering default/all/alias/single selections and global
limits 1/4. They check one aggregate planner call, stage/pool composition and exact
backend query coverage. Independent byte fixtures reproduce the shared-budget
case and reject an oversize worker before launch. A separate real grouped-pool
fixture uses explicit IPC workers and a parent barrier, counts live processes
through delayed SQLite retirement, and retains real sampled parent/worker RSS.
These fixtures do not claim backend quality, native search throughput or whole
process-tree memory acceptance.
