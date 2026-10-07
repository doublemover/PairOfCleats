# Release Matrix Guide

Status: Active guide v1.1
Last audited: 2026-10-05 (Node runtime pins)

## Purpose

Define the authoritative release support matrix for workflow targets, Node runtime, toolchains, and required validation jobs.

## Supported targets

| Target ID | Workflow target | Node | Required toolchains |
| --- | --- | --- | --- |
| `ubuntu-latest-node24` | `ubuntu-latest` | 24.21.0 | Node, npm, Git, optional LSP/tooling installs, editor packaging toolchain, release artifact tooling |
| `windows-latest-node24` | `windows-latest` | 24.21.0 | Node, npm, Git, optional LSP/tooling installs, editor packaging toolchain, release artifact tooling |
| `macos-latest-node24` | `macos-latest` | 24.21.0 | Node, npm, Git, optional LSP/tooling installs, editor packaging toolchain, release artifact tooling |
| `tui-rust-1.88` | `ubuntu-latest`, `windows-latest`, `macos-latest` release matrix | 24.21.0 | Rust 1.88.0, Cargo, Node, npm, Git |

Notes:

- New targets are unsupported until added to this table and validated by required jobs.
- Required toolchains are hard requirements for release lanes. Missing toolchains fail fast.
- `package.json` requires `node >=24.15.0`; CI and release workflows pin `actions/setup-node` to `24.21.0`.
- [Node runtime policy](node-runtime.md) separates the compatibility floor,
  pinned release runtime, action runtimes and the unvalidated Node 26 target.

## Required release jobs

Each supported target must pass:

1. `release-check` deterministic prepare gates.
2. Packaged Node surface build and install verification for active editor integrations.
3. Runtime surface boot/smoke verification for CLI, API, MCP, and indexer service.
4. TUI build and wrapper/install verification for the release matrix.
5. Release bundle assembly and trust-material generation.
6. Integrated readiness gate, including CI/CI Long status and USR technical contract evidence.

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
