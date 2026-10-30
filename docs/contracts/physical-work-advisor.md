# Physical work shadow advisor pilot

`build/runtime/physical-work-advisor.js` accepts a bounded topologically ordered
work graph and supplied calibration receipts. Every alternative declares the
same semantic contract or is rejected; capability mismatches are separate from
missing/stale/partial calibration. Calibration binds hardware, runtime, provider,
configuration, world, implementation and shape. Fixture values are not local
measurements, and this implementation performs no probes or benchmarks.

The advisor reports a preferred candidate by calibrated upper time, but effective
execution remains the declared legal baseline. Missing evidence retains that
baseline. Predicted serial sums and dependency-path intervals remain distinct;
neither assumes overlap, models contention or proves future latency. Startup,
transfer, decode, output and teardown costs must already be included in the
supplied total-time calibration. No learning policy or tuning knob is installed.

`scheduleAdvisedBaseline` connects the unchanged baseline to the existing build
scheduler's CPU/I/O/memory/byte admission. It creates no scheduler, worker pool or
reservation service. Predecessors require owned successful completion receipts
from the same plan. The scheduler task awaits the registered operation's actual
completion fence, then awaits working-resource release before settling. An abort
request cannot race that fence or release native buffers early. Failed/cancelled
work does not mint a successful predecessor receipt.

Registered operator code is a trusted integration boundary: `start` must own
cleanup if allocation fails before it returns, and return its real completion
promise plus `releaseWorking`. That release covers working resources, not leased
retained outputs. Existing output/source/artifact owners retain responsibility
for their long-lived reservations, source leases and publication. This pilot
does not claim aggregate native/RSS accounting, atomic buffer handoff or generic
cleanup of an operator that violates its contract. Execution receipts separate
queue, completion and release times; source completeness stays with the operator.

The graph caps 64 nodes, 16 alternatives each and 256 calibrations, with bounded
metadata. The bridge dispatches one requested node, so the existing caller remains
the orchestration authority. No speculative winner, device path or hardware
setting changes. The useful first step is replayable shadow advice and correctly
fenced baseline admission.

Authored unexecuted fixtures use the actual scheduler owner to check abort during
native completion, release-once, owned predecessor admission and unchanged
baseline selection. They also distinguish serial/dependency-path predictions,
stale/partial measurements, changed semantic contracts and missing capabilities.
Further producer wiring, calibrated resource/lifetime instrumentation, cache-cut
planning, prefetch/shared scans, active alternative admission and measured
prediction/throughput qualification remain open #1523 obligations.

The relations preparation and propagation stages now consume the baseline bridge
through their existing stage2 relations scheduler. Each actual stage declares
only its current implementation. It supplies no calibration and reports null
predictions plus an explicitly unmeasured hardware profile. Build ID, effective
configuration, runtime and input-shape identity pin the private plan; they do not
claim a complete source or hardware model.

Required running/done/failed receipts use the existing build-state phase owner.
A failed required start write prevents work. The baseline completion promise
covers the stage's existing cleanup, and the wrapper allocates no extra working
buffers. Cancellation waits that completion before its failed receipt, while
secondary release/receipt errors cannot replace the original operation failure.
Legacy custom runtimes without a durable build identity retain ordinary baseline
scheduling without fabricated receipts. Overall semantic coverage and output
publication remain with their existing owners. The additional authored relations
integration fixture is unexecuted; calibration, other producer wiring and all
performance qualification remain open.
