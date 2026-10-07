# Release Discipline

This guide defines the canonical release-check and publish-readiness contracts.

## Release Check Command

Run deterministic release-check validation with:

```bash
npm run release:verify
```

The command executes `tools/release/check.js`. It does not replace the integrated publish-readiness gate described below.

The release-check command always writes:

- `release_check_report.json`
- `release-manifest.json`
- `docs/tooling/doc-contract-drift.json`
- `docs/tooling/doc-contract-drift.md`

Both artifacts use ISO-8601 timestamps and stable schema/order.

Release artifact output paths must remain inside the repository root. This applies to release-check reports and manifests, metadata and notes, bundle manifests and checksums, trust material output, readiness summaries, and surface-verification output/capture/install directories. Writable release output paths must also reject existing symlink path segments so an in-repo symlink or junction cannot redirect output outside the repository. Shipped-surface registry `build.sourcePaths`, `build.outputs`, and `releaseCheck.steps[].artifacts` must be repo-relative and resolve under the repository root. Release artifact walkers reject symlink entries before hashing or inventorying files, release-check manifest inventory rejects symlinked artifact paths before hashing explicit artifacts, and surface install archive verification rejects absolute, backslash-separated, traversing, duplicate, or symlink archive entries before extraction.

The CI release workflow now stages release security material separately under `dist/release/trust` and publishes:

- `release-checksum-bundle.json`
- `release-checksums.txt`
- `provenance-summary.json`
- `trust-manifest.json`
- `node-root.cyclonedx.json`
- `tui.cyclonedx.json`

Shipped release surfaces are defined in:

- `docs/tooling/shipped-surfaces.json`
- `docs/guides/release-surfaces.md`

## Required release-check flow

Release-check is strict and deterministic. Required checks cannot be skipped.

Execution order:

1. changelog validation for the current package version
2. contract/spec drift gate (`tools/docs/contract-drift.js --fail`)
3. Python toolchain policy gate (`tools/tooling/python-check.js`)
4. smoke sequence in the exact order declared by the shipped-surface registry:
   - CLI smoke contract
   - indexer-service smoke contract
   - editor package smoke contracts
   - TUI smoke contracts

The smoke sequence is no longer maintained as a hard-coded list inside `tools/release/check.js`; it is derived from the canonical shipped-surface registry.

Matrix-specific release-check reports must record their runtime target with `--runtime-target <id>`. The release workflow uses this for TUI verification jobs so readiness can prove that a `verify-tui-macos` artifact contains a macOS report rather than a copied or renamed report from another target. Readiness also rejects blank, malformed, or duplicated expected TUI target IDs before evaluating the reports.

## Breaking release mode

For breaking releases:

```bash
npm run release:verify -- --breaking
```

This requires a non-empty `### Breaking` section for the current version in `CHANGELOG.md`.

## Removed permissive modes

Blocker-related flags are unsupported (`--blockers-only`, `--no-blockers`, `--allow-blocker-override`, `--override-id`, `--override-marker`).

## Python policy

Python is a required runtime dependency for active tooling flows that package or validate Sublime integrations. Enforce availability with:

```bash
node tools/tooling/python-check.js
```

Core release tooling fails fast when Python is unavailable.

## Versioning policy

- Breaking output/schema behavior requires a major version bump.
- Contract and spec updates ship in the same change as behavior updates.
- Artifact readers/writers and contract docs must stay aligned.

## Trust material and verification

Release trust material is generated from the verified release bundle, not from a second build.

- checksum bundle:
  - `release-checksum-bundle.json`
  - `release-checksums.txt`
- provenance summary:
  - `provenance-summary.json`
  - GitHub artifact attestation from the `attest` job
- SBOMs:
  - `node-root.cyclonedx.json` from `npm sbom`
  - `tui.cyclonedx.json` from `cargo cyclonedx`

Verification expectations:

1. Verify the published artifact checksum against `release-checksums.txt`.
2. Verify the artifact appears in `release-checksum-bundle.json`.
3. Verify the GitHub attestation for the published bundle and trust material.
4. Use the published CycloneDX SBOMs to review dependency inventory for the Node root package and the Rust TUI crate.

## Integrated readiness gate

The release workflow also emits an authoritative ship/no-ship summary:

- `readiness-summary.json`
- `readiness-summary.md`

The readiness gate aggregates:

- release prepare and verify reports with release-check schema shape, complete `summary.byPhase` accounting for every checked phase, ISO-8601 UTC timestamps, and TUI report `scope.runtimeTarget` values that match the verification artifact target; build artifacts are enforced by upstream release-job dependencies and bundle assembly
- schema-shaped trust-material presence, source-commit provenance, trust-manifest SBOM file existence, and attestation readiness
- matching schema-shaped CI and CI Long workflow success for the same shape-valid release commit SHA
- schema-shaped CI quality artifacts (`test-summary.json` aggregate counts, per-test rows, and no failed/redo rows, plus `test-coverage-*.json` or `coverage-*.json` coverage artifacts validated against the test coverage schema)
- USR technical contract evidence: schema-backed matrix reports, conformance shard results, generated-baseline freshness, and docs/contract guards for the current branch.

Publish must depend on this readiness gate rather than on scattered individual checks.

Focused local guard coverage for readiness hardening:

```bash
node tests/run.js tooling/release/readiness-gate ci/workflow-contract --lane=all --timeout-ms 30000
```

The final publish-readiness decision is enforced by `.github/workflows/release.yml`, where the readiness gate consumes schema-shaped release reports for prepare, runtime, node package verification, and every expected TUI verification target, plus schema-shaped trust material, CI status provenance, and CI quality artifacts before producing `readiness-summary.*`. A minimal `{ "ok": true }` report is not sufficient release evidence. Expected TUI target IDs must be non-empty, unique, well formed, and free of blank comma-separated entries; TUI verification reports must declare `scope.runtimeTarget`, and the declared target must match the target inferred from the verification artifact path. Readiness input roots such as TUI verification downloads, trust material, and coverage outputs must stay in the repository and reject existing symlink or junction path segments before walking or reading files.

Surface install verification must parse the sidecar archive manifest, verify its checksum against the archive, require manifest entries to match the archive entries before unpacking, reject duplicate paths, and compare manifest `sizeBytes` and `mode` against archive metadata.
