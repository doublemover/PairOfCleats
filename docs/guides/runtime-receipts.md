# Runtime receipts and launch evidence

`pairofcleats index report --runtime --repo .` lists bounded persisted attempts from
published mode roots and other build candidates. A candidate is never labeled as
a live build based on directory age. `status` includes published-mode receipt
projections. Missing receipts are legacy/unknown evidence, never reconstructed
from the current configuration.

Use `--index-root /path/to/build` to inspect an explicit build without loading
current repository configuration. `--build <generation-id>` selects a generation
under the currently selected repo cache. `--attempt <id>` and `--mode <mode>` filter
attempts. `--json` produces structured output. `--explain embeddings.model` (or
`runtime.maxOldSpaceMb`, `runtime.uvThreadpoolSize`, `runtime.workers`,
`runtime.scheduler`, `paths.cache`, `paths.build`) selects a persisted explanation.
`--redact-paths` substitutes stable within-export path aliases. These flags default
to absent/false; normal artifact reporting remains available without `--runtime`.

Build generation and process attempt are distinct. `build_state.json` owns up to
16 bounded runtime attempts; its existing rotated event journal records lifecycle
transitions. Resume gets a new attempt. Critical receipt persistence is required:
a failed write blocks a successful provenance claim. Terminal attempts retain
terminal status; other records are `recent-unverified` or `stale-or-unknown`.
Neither a recent timestamp nor a PID proves a live process.

Startup settings have requested, launch-planned, and input-observed meanings.
Current V8 `heapSizeLimitBytes` is measured total heap, never an old-space value.
libuv's initialized thread-pool size is unknown because its runtime API does not
acknowledge it. Startup environment snapshots explain inputs, not an operating
system audit of the original launch. Source revision is unknown unless supplied
by a verified build source; indexed-repository SCM does not identify the tool.

Paths retain lexical selection and physical resolution separately. Missing paths
can have a redirected existing ancestor. `EACCES`, `ENOTDIR`, missing, and unknown
remain distinct. Windows paths inspected on a non-Windows host remain unobserved;
Linux tests do not certify Windows junction behavior.

## Worker heap limitation and performance

Node26 treats parent V8 heap flags as process-global: both `NODE_OPTIONS` and
command-line heap flags can override Worker `resourceLimits`. Clearing a Worker's
environment or `execArgv` does not restore the requested smaller cap. Workers
acknowledge their measured total V8 heap and reported resource limits before tasks.

The existing worker budget divides an explicit parent heap among workers plus the
main process. Consequently ordinary explicit-heap launches, including a
16384 MB parent with smaller per-worker budgets, use the existing inline
fallback for tokenization and quantization when the worker cap cannot be enforced.
The requested worker configuration remains in the receipt alongside the fallback
reason. This can materially reduce parsing/tokenization parallelism and throughput.
It does not change embedding-provider inference admission or global dispatch.
Unshaped startup without a conflicting heap override retains worker execution.

There is no supported tokenization/quantization child-process pool in this owner.
A process-isolated executor is separate follow-on work; this patch does not claim
to provide a parallel resource-management remedy for conflicting parent heaps.

Receipts omit raw arguments, environment, credential-bearing fields and arbitrary
Node preload options. Provider/device/thread observations stay unknown when the
backend supplies no acknowledgement. A resolved model identity is not proof of a
loaded model; cache-only completion does not claim fresh inference.

Inline ONNX fallback after cache/signature selection fails closed with the selected
and actual providers recorded. Retry with the explicit observed provider. A changed
getter cannot repair earlier cache reuse; transparent replay of that attempt is a
separate follow-on. Deferred stage3 still binds actual probe identity before reuse.

Stage2/stage4 and deferred stage3 persist initialization, execution and terminal
attempts. Stage3 uses a distinct attempt per mode and records the parent attempt
through the existing launch context. Pinned runs preserve prior build phases,
progress and checkpoint evidence; admission checks understood producer identity
and the runtime contract, not every historical build-state metadata field.

Scheduler receipts contain compact admission counters/caps, not scheduler trace
rings. Inline first-inference dimensions remain observations when dimensions were
not declared: they do not silently change an already-selected cache/signature key.
Abrupt process death can leave a running receipt; diagnostics show unverified or
stale evidence, never synthesize a terminal success.
