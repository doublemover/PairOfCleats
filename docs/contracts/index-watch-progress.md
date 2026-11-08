# Index watch progress observations

Status: source implementation, unvalidated (2026-10-22).

`watchIndex` emits through the existing `writeProgressEvent` owner when the
canonical progress mode is JSONL. These are `poc.progress@2` task events with
`taskId=watch:monitor`, `stage=watch` and the existing run/job context. Human logs,
watch callbacks, scheduling, publication and original errors retain their owners.

The typed `phase` is `starting`, `monitoring`, `updating`, `degraded`, `stopping`
or `stopped`. `state=idle` means an admitted watcher has no queued work; active
work is `state=active`. `watchReady` and `readiness.watcher` report watcher
admission without an outstanding watcher/update error. They do not report index
readiness. `quiescent`, `backlogDepth`, `pendingReplay`, `consistency`,
`lastEventAt` and generation observations come from the existing watch state.

`publicationCommitted` and `readiness.publishedGeneration` mean this watch session
observed its canonical promotion commit. `lastConsistentGeneration` identifies
that generation. `readiness.searchReady` remains null: watch validation/promotion
does not qualify every search backend. There is no inferred percent, ETA or
synthetic heartbeat when the snapshot is unchanged.

`degradedReason`, `degradedReasons` and bounded `errorCode` describe explicit
startup, update, validation, build, lock, bookkeeping, scheduler or watcher
failures. A successful rebuild clears recoverable build reasons. A watcher error
remains degraded for that watcher instance; build success does not prove that
future file changes will be observed. Best-effort per-file update failures also
stay degraded until watcher replacement.

Shutdown first emits `stopping` while the original watcher/build teardown runs.
`task:end` is emitted after that teardown attempt. Its `failed` status and
`ownershipPending` preserve an original teardown/ownership failure; requesting
cancellation or closing a PID does not manufacture closure. Startup failures
retain their original throw and show degraded progress without claiming stopped
resources. Consumers should retain canonical job termination evidence separately.

The authored structured-progress fixture exercises actual watch orchestration and
the canonical JSONL writer with small injected build/watcher owners. No test,
native backend, native terminal or editor acceptance ran in this source span.
