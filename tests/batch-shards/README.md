# USR Batch Shards

This directory holds shared assertions for roadmap phase-10 batch lane sharding.

## Source of truth

- `tests/lang/matrix/usr-language-batch-shards.json`

## Deterministic order manifests

Each batch lane has a required deterministic order file:

- `tests/batch-b0/batch-b0.order.txt`
- `tests/batch-b1/batch-b1.order.txt`
- `tests/batch-b2/batch-b2.order.txt`
- `tests/batch-b3/batch-b3.order.txt`
- `tests/batch-b4/batch-b4.order.txt`
- `tests/batch-b5/batch-b5.order.txt`
- `tests/batch-b6/batch-b6.order.txt`
- `tests/batch-b7/batch-b7.order.txt`
- `tests/batch-b8/batch-b8.order.txt`

Batch lane tests call `tests/batch-shards/assert-batch-shard.js` to validate:

1. schema and coverage consistency between batch shards and language profiles
2. lane-to-manifest path determinism
3. sorted deterministic order entries in each lane manifest
