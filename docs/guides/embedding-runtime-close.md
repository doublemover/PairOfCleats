# Embedding runtime close and reconciliation

The inline build runtime closes admission, joins its original inference and
notification work, closes its batcher and releases its original adapter lease.
An unused runtime does not initialize a model. Concurrent close calls join the
same attempt; confirmed steps do not run again.

A rejected inference or notification can still own native or independent
diagnostic work after its promise settles. Close retains the original observation
and blocks parent lease disposal until that work is confirmed settled. Replacing
the rejected value's public marker or observer cannot grant release. Failed
notifications preserve the native rejection and their own exact rejected values.

A failed close exposes `closeEmbeddingRuntime()` for explicit reconciliation.
Its `cacheOwnershipReleased()` becomes true only after the actual runtime close
finishes. A subsequent explicit call can retry the captured original disposer;
inference is never retried by cleanup. Explicitly false disposal results remain
unconfirmed. Unresolved failure inventories are bounded and exhaustion fails
closed instead of forgetting ownership.

Daemon warm retirement retains the exact lease and disposal method across
replacement, eviction, recycle and shutdown. Observational drain does not consume
failures or retry disposal. Explicit remove/close can reconcile the original
lease, while independent diagnostic inspectors must settle before another native
disposal call. Drain reports those original inspection failures separately, and
public diagnostic arrays cannot erase the private ownership state.

The small consumer regressions are authored. Runtime and real-provider
qualification remain deferred until the shared source wave is frozen.
