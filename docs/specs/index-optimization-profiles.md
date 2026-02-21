# Index Optimization Profiles

Status: Active v1.0  
Last updated: 2026-02-21T00:00:00Z

## Canonical selector

`indexOptimizationProfile` is the single canonical optimization selector for index-build runtime tuning.

Allowed values:

- `default`
- `throughput`
- `memory-saver`

## Policy

- `default` is the primary production path.
- Profile value must be schema-validated in perf artifacts.
- Temporary experiment-only override flags are not a contract surface.
