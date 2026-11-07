# Benchmark process-tree resident-memory observations

Current implementation and thirteen authored cases are unvalidated.

The language query benchmark retains its aggregate resource-plan admission and
parent/known-worker RSS metric. A separate bounded Windows observer now samples
the benchmark root and its discovered live descendants across each admitted
query phase. Existing subprocess ownership supplies a hidden, noninteractive,
three-second observer with bounded output and close/termination handling. No
elevation, security-setting change, WSL or external process termination is added.
Other platforms report unsupported; they are not qualified by Windows evidence.

The read-only CIM query requests PID, parent PID, creation date and working-set
bytes. Command lines, executable paths, environment and unrelated process rows
are not retained. Windows reuses PIDs; parentage is checked against observed
creation identity rather than PID alone. CIM creation dates retain their decimal
UTC ticks, avoiding JavaScript timestamp rounding. WorkingSetSize is byte-valued;
PeakWorkingSetSize has different units and is not used. These semantics follow
[Win32_Process](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process)
and the read-only [Get-CimInstance owner](https://learn.microsoft.com/en-us/powershell/module/cimcmdlets/get-ciminstance).

The observer process and its descendants are excluded from the target sum. A
previously observed descendant incarnation stays attributable after its parent
disappears. A new orphan cannot borrow that authority from a recycled parent PID;
unresolved links remain partial observations. Missing resident bytes, ambiguous
identity, duplicate rows, changed root lifetime, malformed/truncated output and
observation capacity failures never become a complete numeric zero.

Each sample retains its scan start/end, phase, reason, resident bytes, selected
process rows, exclusions and unresolved ancestry. Phase and per-process observed
lifetimes, pool start/close events, missed worker lifetimes, unclosed events,
sampling gaps, caps and observer cost remain visible. Absence in a later scan is
not an exact process exit; reappearance preserves the earlier gap. Source scans
are not atomic snapshots. Shared resident pages may contribute to multiple
process working sets. The reported sampled peak is always a lower bound, not an
instantaneous whole-tree high-water mark or a hard memory ceiling. Work between
samples can be missed; the metric never claims otherwise.

Default bounds are 128 samples, 256 processes per selected tree, 2,048 pool
events, 4,096 observed incarnations, 16 sequential phases, 8,192 census rows and
2 MiB per observer output stream. Observers serialize; phase shutdown cancels
future timers and drains the in-flight observer. A normal unavailable observation
is recorded as unavailable. An unsettled observer resource remains a failure
through the existing resource/failure-context owner and cannot start another
observer or be downgraded to a missing numeric metric.

Query execution uses the existing settled-concurrency owner: the first failure
stops new task execution while started tasks settle. Pool shutdown follows that
drain; all phase/sampler cleanup still runs. Primary query and secondary cleanup
failures retain their original error graph and diagnostic observation. No retry,
deadline increase, removed backend or relaxed aggregate resource cap is used.

Benchmark wall time includes observer boundary work and may overlap observer
scans during queries; the separately reported observer cost is not a valid
quantity to subtract from concurrent wall time. Worker latency and known-worker
RSS stay separate. A performance comparison needs its own declared observation,
workload, OS-cache and serial-execution policy.

The thirteen new cases use controlled rows, clocks, barriers and observer-command
fixtures, including actual query-executor drain. No CIM query, real process-tree
measurement or functional fixture ran during this source wave. #1675 still needs
actual Windows parent/child/native-descendant lifecycle and resource qualification,
including observer availability, timing/cap coverage and output parity.
