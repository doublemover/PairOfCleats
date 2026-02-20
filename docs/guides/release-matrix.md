# Release Matrix Guide

Status: Draft v1.0  
Last updated: 2026-02-20T00:00:00Z

## Purpose

Define the authoritative release support matrix for OS/arch/Node/toolchain combinations and required validation jobs.

## Supported targets

| Target ID | OS | Arch | Node | Required toolchains |
| --- | --- | --- | --- | --- |
| `win-x64-node20` | Windows 11/Server 2022 | x64 | 20.x LTS | Node, npm, Git, Python (release/test if enabled), VS Code packaging toolchain, Sublime packaging toolchain |
| `linux-x64-node20` | Ubuntu 22.04+ | x64 | 20.x LTS | Node, npm, Git, Python (release/test if enabled), editor packaging toolchain |
| `linux-arm64-node20` | Ubuntu 22.04+ | arm64 | 20.x LTS | Node, npm, Git, Python (release/test if enabled), editor packaging toolchain |
| `macos-arm64-node20` | macOS 14+ | arm64 | 20.x LTS | Node, npm, Git, Python (release/test if enabled), editor packaging toolchain |

Notes:

- New targets are unsupported until added to this table and validated by required jobs.
- Required toolchains are hard requirements for release lanes. Missing toolchains fail fast.

## Required release jobs

Each supported target must pass:

1. `release-check` deterministic smoke sequence.
2. Packaging checks for active editor integrations.
3. Service-mode smoke.
4. Contract/spec drift checks.

## Failure taxonomy

- `infra_flake`: CI/service/transient infra issue.
- `product_regression`: behavior or output changed unexpectedly.
- `toolchain_missing`: required runtime or packaging dependency missing.

## Decision rules

1. A release is blocked if any required target fails a required job.
2. Advisory jobs do not block release.
3. A target may be removed only by editing this document and corresponding CI policy docs in the same change.

## Related docs

- `docs/guides/release-discipline.md`
- `docs/guides/ci-gate-policy.md`
- `tools/release/check.js`
