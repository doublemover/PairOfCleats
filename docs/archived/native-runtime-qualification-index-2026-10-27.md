# Native and runtime qualification index — 2026-10-27

Historical receipt-table snapshot from published head `adbcaf777ce91642bb0a60de892171d8c3a529f7`.
Each link retains its own source identity and check boundaries. The active
[roadmap](../roadmap.md) owns execution order and current pending work.

| Receipt / source | Issue scope | Passing affected checks |
| --- | --- | --- |
| [Boundaries](remaining-issue-repairs-2026-10-26.md), [services](service-progress-repairs-2026-10-26.md), [retirement](cache-retirement-repairs-2026-10-27.md), [runtime](runtime-p1-closeout-2026-10-27.md), [stages](stage-closeout-repairs-2026-10-27.md) | Request, service and runtime closures | Source-specific affected checks + full front gates |
| [a73b37be1](storage-artifact-p1-closeout-2026-10-27.md) | #1089, #1109, #1551 | 12 + full front gate |
| [7c3683ad0](watch-retention-repairs-2026-10-27.md) | #690 | 38 + full front gate |
| [1f7579910](cache-ownership-p1-closeout-2026-10-27.md) | #1582, #1746 | 12 + full front gate |
| [Cleanup](repository-cleanup-admission-2026-10-27.md), [SQLite](sqlite-uncached-close-ownership-2026-10-27.md), [LMDB](lmdb-lifetime-and-parity-2026-10-27.md), [reader sessions](native-reader-sessions-2026-10-27.md) | #1084/#1093 closed; #1574 partial | Source-specific checks and full front gates in receipts |
| [957230b12](tui-install-qualification-2026-10-27.md) | #1554; actual Windows upgrade/sharing | 7 + 3 native controls + full front gate |
| [e191d2402](sublime-native-registration-2026-10-27.md) | Partial #1289; native command registration repaired; search/reload pending | 30 headless + full front gate |
| [afc52ef9d](crash-log-qualification-2026-10-27.md) | Partial #1315/#1547; bounded crash projection, Windows sharing and fresh semantic authority | 26 + native control + full front gate |
| [bee92206e](windows-child-window-repairs-2026-10-27.md) | Partial #1289; suppress child windows, repair UI lock cycle; native search pending | 38 + private desktop control + full front gate |
| [ee01bb7fc](generation-selection-repairs-2026-10-27.md) | #347 closed; captured generation and SQLite state ownership | 34 + full front gate |
| [294e971bb](query-vector-admission-2026-10-27.md) | #1006 closed; #1544 actual models/perf pending | 27 prior cohort; 14 final rechecks + full front gate |
| [Commands](native-command-sessions-2026-10-27.md), [probes](sqlite-probe-sessions-2026-10-27.md), [validators](native-validator-sessions-2026-10-27.md), [writers](sqlite-writer-owners-2026-10-27.md) | #1574 native ownership; registration/adoption remains | 24/28/32/17 + full front gates |
