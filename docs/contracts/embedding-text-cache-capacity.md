# Persistent text-vector capacity turnover

The text-vector database retains its 64 MiB hard page limit, complete rollback
journal/profile reservation, bounded pending queue, versioned row digest and
encoding/identity admission. Capacity turnover does not change vector meaning.

Each write transaction applies coalesced access touches, reserves conservative
page-allocation headroom for its incoming batch, and, when needed, removes oldest
rows through the existing indexed eviction statement. Ties use hit count and
cache key. Eviction is bounded to 16 rounds of at most 16,384 rows, with page/free
geometry checked between rounds; one row count serves the pressure path. There
is no whole-table blob scan, per-vector VACUUM or unbounded retry. Touches, eviction
and publication commit or roll back together. Remembered persisted digests are
cleared only after committed eviction, so removed rows can be persisted again.

The reservation is conservative admission, not an exact SQLite allocation model.
An inadmissible batch or insufficient bounded reclamation returns advisory flush
failure with separate admission-failure/rejected-write counters. Committed
capacity evictions/rounds and useful persisted writes have separate counts;
existing count-overflow pruning retains its owner. Actual page size/limit are
reported alongside the existing capacity ceiling.

No `SQLITE_FULL`, copied error code, I/O failure or unsettled-resource error proves
recoverable database-capacity exhaustion. Those failures retain existing resource
settlement and advisory/error semantics; they do not trigger eviction-and-retry.
The hard page limit remains the final bound if the conservative estimate is
insufficient. Original row integrity, float32/float16 conversion, queue bounds,
profile locking, lifetime and close/reconciliation behavior remain in force.

The small regression uses real SQLite with a stricter fixture-only page limit,
repeated working-set turnover, hot touches, close/reopen parity and explicit
generic-pressure failures. A separate serial measurement fixture uses 1024-wide
float32/float16 rows, three payload-capacity turnovers at a stricter real 8 MiB
SQLite page cap and a fresh child process for exact persisted hits. It records
per-cycle hit/miss, deterministic recording-provider call, transaction, byte,
eviction and elapsed-time samples. This measures cache work under the stated
capacity; it does not qualify real-model inference latency, native RSS or larger
production workloads. Production database, journal and profile limits remain
unchanged. Author-workspace run receipts are historical evidence, not files
promised in a clean checkout.
