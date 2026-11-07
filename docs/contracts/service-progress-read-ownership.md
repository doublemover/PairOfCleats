# Service progress read ownership

Status: #1593 qualified on Windows/Node 26.12.1 at `8bf742ec6`.

The queue worker hands its live monitor callback directly to the executor. It is
never read from serialized job fields. The required runtime-receipt writer emits
one exact repository/build-root/build-ID/attempt/correlation/stage binding after
durable persistence. Daemon jobs retain separate async scopes; subprocess jobs
use a private IPC descriptor and preload restricted to the direct executor child.
Inherited preloads do not write to descendant or worker-thread IPC protocols.
Stage-3 receipts use the same durable producer. Normal monitors report pending
until that binding arrives and perform no retained-history discovery while waiting.

The monitor now retains only the exact build root, build ID and runtime attempt
after executor binding or compatibility ownership selection. Each bound poll reads that one state
and revalidates the latest attempt, claim correlation, stage and repository/root
identity. It performs no retained-directory enumeration, mtime sorting or unrelated
state reads while that binding stays valid. Disappearance, corruption or changed
ownership invalidates the confirmed binding. A later executor binding supersedes
captured reads before they can publish; a temporarily missing state is rechecked
only at the exact executor-selected identity. A sticky path
alone never establishes ownership. Existing predecessor, concurrent-claim and
resumed-build negatives remain unchanged.

Compatibility discovery shares one repository-scoped, reference-counted owner.
It incrementally reads at most 64 directory entries and state files per page,
without retained-root stats or mtime sorting. Concurrent waiting monitors share
the original scan promise and retain at most 64 bounded identity hints, never a
page of full states. Page scheduling uses 5-second intervals and completed/absent
cycles back off to at most 30 seconds. Hints require a fresh exact-state read
before presentation. A stale hint cannot restore foreign ownership. The existing
storage-directory owner retains admitted reads and the original close; the final
subscriber drains that work. A failed close blocks replacement until original
resource recovery confirms settlement.

State reads use the existing contained descriptor/verified-byte owner, capped
at 1 MiB before allocation or decode. Only completed bytes enter fatal UTF-8 decoding
and JSON object admission. Structured observations distinguish ok, missing,
oversized, corrupt, unsafe and transient outcomes. JSON-decode attempts and known
read bytes are separate from unknown failed-read work; failure is never a numeric
zero-work observation. The nullable compatibility helper remains available for
embedding replay. Pending original resources or unreadable diagnostic authority
propagate through the storage observer rather than becoming a harmless null.

The existing lifecycle still owns the production timer and one captured poll.
Concurrent poll requests share that promise. Stop drains actual I/O and suppresses
late presentation before dropping the binding. Internal fixed-size diagnostics
record bound/candidate reads, discovery cycles, invalidations, classified outcomes,
known bytes and JSON decodes. They retain no parsed state between polls and change
no public CLI, configuration, artifact or log-text contract.

Executed real-file controls cover 1/8/32/135 retained roots and four waiting
clients: one shared cycle reads each retained root once; 135 roots require three
bounded pages. Two bound monitors over three polls read exactly six state files,
with no retained-directory enumeration or stats. Coverage retains predecessor,
concurrent/resumed claims, changed correlation, corrupt/oversized state, extent
admission before payload reads, captured-poll drain, attempt-change races and
failed-close recovery. Actual child IPC and concurrent daemon scopes are covered.

The [qualification receipt](../archived/service-progress-repairs-2026-10-26.md)
records 15 related service/runtime/queue/logging fixtures, the complete cheap front
gate, original failures and the task-local launch adjustment. These measurements
qualify bounded resource work; they make no wall-time, native backend, full-suite
or non-Windows performance claim.
