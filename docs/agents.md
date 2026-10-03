# Repository work guide

This is the secondary entry point for coding agents and contributors working on
PairOfCleats. The [README](../README.md) is the starting point for people using
the product. This guide links the deeper work instructions; it does not replace
them or create a competing task tracker.

## Before changing code

1. Read [AGENTS.md](../AGENTS.md) and any more-specific instructions in the area
   you will change. Keep the actual executor's shell/platform in mind.
2. Inspect the current working tree and preserve unrelated authored work.
3. Follow the requested environment and scope. Check existing source and
   authoritative contracts before proposing a new abstraction.
4. Read current [configuration](config/contract.md) and
   [execution policy](guides/execution-authority.md) before launching external
   tooling or using operator-owned configuration.
5. Choose the smallest meaningful validation and resource limits for the task.
   A tiny parser check, live language client, compiler check and full index are
   different evidence; report which one actually ran.

## Product and source owners

| Area | Start here |
| --- | --- |
| CLI command routing | bin/pairofcleats.js; src/shared/command-registry-data.js |
| Indexing and artifact publication | src/index/build/; src/contracts/; [indexing contract](contracts/indexing.md) |
| Language routing and parser ownership | src/index/language-registry/; src/lang/; [language descriptor contract](specs/usr-language-descriptor-contract.md) |
| Retrieval and output | src/retrieval/; [search guide](guides/search.md); [search contract](contracts/search-contract.md) |
| Graph, impact and context | src/graph/; src/integrations/tooling/ |
| Storage | src/storage/; [SQLite contract](contracts/sqlite.md) |
| Configuration/runtime/resource policy | src/config/; src/shared/; [configuration schema](config/schema.json) |
| Integrations | extensions/; sublime/; tools/api/; tools/mcp/ |
| Test runner and fixtures | tests/runner/; tests/helpers/; [current runner](../tests/run.js) |

Use the [command reference](guides/commands.md) for user-facing workflows.
Root build_index.js and search.js are compatibility entry points; prefer the
canonical CLI in new examples. Generated command/config documents name their
generator and source of truth. Do not hand-edit a generated surface to hide a
source mismatch.

## Install and validate deliberately

Use Node.js 24.15.0 or newer and a source-checkout install with development
dependencies; required patch tooling and native rebuilds are part of that path.
Use the [first-search guide](guides/first-search.md) for a modest first run.

- Read [AGENTS.md](../AGENTS.md) for ESM/style/format/test requirements.
- Run targeted existing behavior tests and add a narrow regression for a real
  correction. The custom runner is tests/run.js; inspect its supported filters
  before running a broad lane.
- Stop a test exceeding 30 seconds as instructed. For work that does not require
  embeddings, keep model downloads and embedding execution disabled.
- Run the repository's formatter before a code commit. Record a timeout or
  changed-file check truthfully instead of claiming a full pass.
- Preserve deterministic IDs/order, UTF-16/source coordinate provenance,
  manifest/schema/version compatibility and partial/unsupported labels.
- Keep resource ownership, cancellation, deadlines, cleanup and explicit operator
  choices intact. An optimization cannot silently widen defaults or execution.

The [language acceptance record](guides/language-toolchain-acceptance.md) separates
component/native grammar, syntax owners, live LSP clients and their limitations.
Dated validation receipts are not a fresh whole-tree result.

## Keep changes reviewable

Use the existing [roadmap](roadmap.md) when a task needs published status. Do not
revive competing general trackers.

For a completed section, record the exact tested code head, checks and limits.
Keep implementation, compatibility corrections and evidence-only documentation
separately reviewable when that clarifies the result. Publish only through the
workflow and repository/branch the owner has authorized. A draft PR is not
authorization to merge it.

Report concrete outcomes and remaining limitations. Avoid inflated “full AST,”
“all languages,” “zero issues” or performance claims that the fixtures do not
establish. Keep raw private evidence and credentials out of public documentation.

## Deeper references

- [Artifact contract](contracts/artifact-contract.md)
- [Public artifact surface](contracts/public-artifact-surface.md)
- [Configuration and environment overrides](config/env-overrides.md)
- [Runtime envelope](specs/runtime-envelope.md)
- [Language descriptor contract](specs/usr-language-descriptor-contract.md)
- [Performance design notes](perf/retrieval-pipeline.md)
- [Release discipline](guides/release-discipline.md)
