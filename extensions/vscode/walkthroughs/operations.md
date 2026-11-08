# Inspect, stop and recover an operation

Use **PairOfCleats: Inspect Tasks** to choose an exact repository and operation. Inspect its structured stage, counters, elapsed/idle time and raw logs; cancel that selected task through the native picker. Cancellation remains stopping until owned resources settle. Missing structured progress stays indeterminate.

A typed **idle-watch** observation means the watcher was admitted and has no queued work. Its **Publication committed** line names a generation only when this watch observed a canonical promotion commit. Search/backend readiness remains unknown; watcher admission and publication are separate observations. A degraded watcher shows its typed reason/code and retains the last observed publication separately. Terminal watch events do not release an owned process before process settlement, and pending teardown remains a failure even after a requested stop.

**Start Service API** remains starting until its listener startup frame is observed. **Stop Service API**, **Stop Service Indexer** and **Stop Index Watch** target their owned sessions. Failures offer deliberate diagnostics/config/retry actions; they do not automatically install tools, change binds, rebuild or restart.

The bundled [user guide](../README.md) covers installation, API cli/prefer/require policy, service repository/source mapping and supported execution hosts. Use **Show Effective Settings**, **Tooling Doctor** and **Index Health** for diagnosis before a deliberate retry.
