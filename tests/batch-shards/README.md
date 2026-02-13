# USR Batch Shards

This directory holds shared assertions for roadmap phase-10 batch lane sharding.

## Source of truth

- `tests/lang/matrix/usr-language-batch-shards.json`

## Deterministic order manifests

Each batch lane has a required deterministic order file:

- `tests/batch-foundation/batch-foundation.order.txt`
- `tests/batch-javascript-typescript/batch-javascript-typescript.order.txt`
- `tests/batch-systems-languages/batch-systems-languages.order.txt`
- `tests/batch-managed-languages/batch-managed-languages.order.txt`
- `tests/batch-dynamic-languages/batch-dynamic-languages.order.txt`
- `tests/batch-markup-style-template/batch-markup-style-template.order.txt`
- `tests/batch-data-interface-dsl/batch-data-interface-dsl.order.txt`
- `tests/batch-build-infra-dsl/batch-build-infra-dsl.order.txt`
- `tests/batch-cross-batch-integration/batch-cross-batch-integration.order.txt`

Batch lane tests call `tests/batch-shards/assert-batch-shard.js` to validate:

1. schema and coverage consistency between batch shards and language profiles
2. lane-to-manifest path determinism
3. sorted deterministic order entries in each lane manifest
