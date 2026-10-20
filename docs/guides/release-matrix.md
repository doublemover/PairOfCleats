# Release Matrix Guide

Status: Active guide v1.1
Last audited: 2026-10-18 (checked-in runtime and workflow contracts)

## Purpose

Define the authoritative release support matrix for workflow targets, Node runtime, toolchains, and required validation jobs.

## Supported targets

| Target ID | Workflow target | Node | Required toolchains |
| --- | --- | --- | --- |
| `ubuntu` | `ubuntu-latest` | 26.10.0 | Node, npm, Git, optional LSP/tooling installs, editor packaging toolchain, release artifact tooling |
| `windows` | `windows-latest` | 26.10.0 | Node, npm, Git, optional LSP/tooling installs, editor packaging toolchain, release artifact tooling |
| `macos` | `macos-latest` | 26.10.0 | Node, npm, Git, optional LSP/tooling installs, editor packaging toolchain, release artifact tooling |
| `tui-rust-1.88` | `ubuntu-latest`, `windows-latest`, `macos-latest` release matrix | 26.10.0 | Rust 1.88.0, Cargo, Node, npm, Git |

Notes:

- New targets are unsupported until added to this table and validated by required jobs.
- Required toolchains are hard requirements for release lanes. Missing toolchains fail fast.
- `package.json` requires `node >=26.10.0 <27`; CI and release workflows pin `actions/setup-node` to `26.10.0`.
- The platform IDs match the CI job names and release TUI `release_id` values;
  `tui-rust-1.88` identifies the shared Rust toolchain rather than a workflow job.
- [Node runtime policy](node-runtime.md) separates the application runtime,
  pinned release runtime and action runtimes. This matrix defines required
  qualification; it does not establish that every target has passed at this head.

## Required release jobs

The [qualification matrix](../testing/qualification-matrix.md) describes the
minimum useful platform/performance evidence and the limits of local fixtures.

Each supported target must pass:

1. `release-check` deterministic prepare gates.
2. Packaged Node surface build and install verification for active editor integrations.
3. Runtime surface boot/smoke verification for CLI, API, MCP, and indexer service.
4. TUI build and wrapper/install verification for the release matrix.
5. Release bundle assembly and trust-material generation.
6. Integrated readiness gate, including CI/CI Long status and USR technical contract evidence.

CI Long is release evidence at the exact release SHA, dispatched manually or by
release-tag automation. It is not required on ordinary PRs; the complete merge
job inventory and repository-enforcement limits are in the
[CI gate policy](ci-gate-policy.md).

Promotion stages every file from downloads, bundle and trust under a stable
unique asset basename before creating or updating a GitHub release. Each name
contains the SHA-256 of its original relative path and a readable filename suffix.
`release-asset-map.json` maps every original relative path to its promoted name,
byte length and content SHA-256. Reruns use the same names and validate all names
and staged bytes first; display labels do not provide filename uniqueness.

## Failure taxonomy

- `infra_flake`: CI/service/transient infra issue.
- `product_regression`: behavior or output changed unexpectedly.
- `toolchain_missing`: required runtime or packaging dependency missing.

## Decision rules

1. A release is blocked if any required target fails a required job.
2. Advisory jobs do not block release.
3. A target may be removed only by editing this document and corresponding CI policy docs in the same change.
4. The archived USR approval lock is historical only and must not block release authorization when required technical jobs pass.

## Related docs

- `docs/guides/release-discipline.md`
- `docs/guides/ci-gate-policy.md`
- `docs/roadmap-release-validation-plan.md`
- `tools/release/check.js`
