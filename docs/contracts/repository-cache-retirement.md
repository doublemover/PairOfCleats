# Repository cache retirement

`repoCache.shutdown(entry)` accepts a synchronous `void` result or a `Promise<void>`.
The repository manager invokes the original hook once for each retirement request
(generation change, LRU eviction, or explicit removal). LRU disposal remains
synchronous. It never awaits or automatically retries the callback.

`closeRepoCaches()` and `clearRepoCaches(root)` preserve their synchronous return
and error behavior. A receipt remains `retiring` while an original asynchronous
shutdown hook or an outstanding SQLite lease is pending. `pendingShutdownHooks`
and `oldestShutdownAgeMs` describe hooks separately from SQLite `pendingOwners`,
`activeLeaseOwners`, and `failedCloseOwners`. Repeated close/report calls observe
the same accepted work and do not invoke a removed entry's hook again.

After requesting retirement, `awaitRepoRetirement(root?)` awaits the already
accepted original shutdown promises and returns the final retirement report.
It does not close active entries, wait for external SQLite leases, poll, retry
native closure, or prevent concurrent new work. Newly accepted work can therefore
leave its returned receipt `retiring`.

Synchronous and asynchronous failures retain their original causes and resource
observations. A rejected hook remains a failed outcome even when its associated
resource eventually releases: a caller must receive a terminal failure report
after release before subsequent reports can reconcile that diagnostic. A failed
report's `cacheOwnershipReleased()` is a resource observation, not a success
certificate. At most 128 original hooks per retiring entry may be pending; a
further request fails before invoking another hook and still attempts independent
terminal SQLite disposal. There is no new native-handle registry or polling timer.
