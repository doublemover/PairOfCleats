# Inspect and recover retained builds

`index recover` uses the existing build recovery owner. It inspects by default;
execution requires an explicit reviewed plan file. Candidate inventory and graph
metadata reads never select the latest/current generation as a fallback.

```text
pairofcleats index recover --repo <repository> --action candidates --json
pairofcleats index recover --repo <repository> --index-root <retained-build-root> --operation graph --json
```

Save the complete inspection JSON as the reviewed plan, check its exact root,
source/configuration/pointer identities, required work, blockers and publication
intent, then execute that file explicitly:

```text
pairofcleats index recover --repo <repository> --action execute --plan-file reviewed-plan.json --json
```

The CLI accepts at most 512 KiB of strict UTF-8 plan JSON. It rejects conflicting
execution selectors. The backend revalidates the plan and current authority; a
modified or stale plan cannot borrow earlier validation. `validate`, `graph`,
`publish`, `resume`, `refresh` and `clean` have separate reviewed intents. Inspecting
one does not execute it. Build operations expose their destination, reused/rebuilt
modes and unknown budgets; they do not silently reinterpret historical work.

Graph validation is independent of embeddings/SQLite and aggregate success.
`--action open-graph --index-root <retained-build-root>` reads capability metadata;
`--graph-capability <id>` selects an exact existing identity. Actual map consumption
uses the reader callback described in [code maps](code-maps.md), retaining its
lease across source reads, rendering and publication. It never promotes a failed
attempt or changes normal search selection.

The active source wave has authored CLI/backend/consumer regressions. Runtime,
platform and full frozen-candidate acceptance remain pending; this guide is not
an execution receipt.
