# Inspect, stop and recover an operation

Use **PairOfCleats: Inspect Tasks** to choose an exact repository and operation. Inspect its structured stage, counters, elapsed/idle time and raw logs; cancel that selected task through the native picker. Cancellation remains stopping until owned resources settle. Missing structured progress stays indeterminate.

**Start Service API** remains starting until its listener startup frame is observed. **Stop Service API**, **Stop Service Indexer** and **Stop Index Watch** target their owned sessions. Failures offer deliberate diagnostics/config/retry actions; they do not automatically install tools, change binds, rebuild or restart.

The bundled [user guide](../README.md) covers installation, API cli/prefer/require policy, service repository/source mapping and supported execution hosts. Use **Show Effective Settings**, **Tooling Doctor** and **Index Health** for diagnosis before a deliberate retry.
