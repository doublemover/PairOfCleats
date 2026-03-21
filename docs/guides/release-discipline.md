# Release Discipline

This guide defines the canonical release validation contract.

## Canonical command

Run release validation with:

```bash
npm run release:verify
```

The command executes `tools/release/check.js` and always writes:

- `release_check_report.json`
- `release-manifest.json`
- `docs/tooling/doc-contract-drift.json`
- `docs/tooling/doc-contract-drift.md`

Both artifacts use ISO-8601 timestamps and stable schema/order.

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

- release prepare/build/verify reports
- trust-material presence and attestation readiness
- matching CI and CI Long workflow success for the same commit
- CI quality artifacts (`test-summary.json` and coverage outputs)

Publish must depend on this readiness gate rather than on scattered individual checks.
