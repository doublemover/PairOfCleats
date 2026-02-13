# USR Language Shards

This directory holds shared assertions for roadmap phase-10 language-shard conformance grouping.

## Source of truth

- `tests/lang/matrix/usr-language-batch-shards.json` (legacy filename, language shard registry)

## Deterministic order manifests

Each language shard has a required deterministic order file:

- `tests/conformance/language-shards/foundation/foundation.order.txt`
- `tests/conformance/language-shards/javascript-typescript/javascript-typescript.order.txt`
- `tests/conformance/language-shards/systems-languages/systems-languages.order.txt`
- `tests/conformance/language-shards/managed-languages/managed-languages.order.txt`
- `tests/conformance/language-shards/dynamic-languages/dynamic-languages.order.txt`
- `tests/conformance/language-shards/markup-style-template/markup-style-template.order.txt`
- `tests/conformance/language-shards/data-interface-dsl/data-interface-dsl.order.txt`
- `tests/conformance/language-shards/build-infra-dsl/build-infra-dsl.order.txt`
- `tests/conformance/language-shards/cross-language-integration/cross-language-integration.order.txt`

Language shard tests call `tests/conformance/language-shards/assert-language-shard.js` to validate:

1. schema and coverage consistency between batch shards and language profiles
2. shard-id to manifest path determinism
3. sorted deterministic order entries in each lane manifest
