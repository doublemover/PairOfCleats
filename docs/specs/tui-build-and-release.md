# TUI Build and Release Spec

## Scope

Defines deterministic build metadata for Rust TUI artifacts and their Node-side release checks.

## Canonical Target Mapping

- Source of truth: `tools/tui/targets.json`
- Each entry must define:
  - `triple`
  - `platform`
  - `artifactName`
- This mapping is consumed directly by build, install, and wrapper resolution (`tools/tui/targets.js`).

## Build Manifest

- Builder: `node tools/tui/build.js --smoke`
- Outputs:
  - `dist/tui/tui-artifacts-manifest.json`
  - `dist/tui/tui-artifacts-manifest.json.sha256`

Manifest contract:

- deterministic key ordering
- deterministic target ordering by triple
- `pathPolicy: "repo-relative-posix"`
- per-target `sha256` recorded when artifact exists
- includes checksum for `tools/tui/targets.json` to detect target-map drift

## Release Integration

- `tools/release/check.js` must execute TUI build smoke:
  - step id: `smoke.tui-build`
- release check artifacts must include both manifest and checksum.

## Toolchain Reproducibility

- Rust crate path: `crates/pairofcleats-tui/`
- pinned toolchain file: `crates/pairofcleats-tui/rust-toolchain.toml`
- pinned dependency versions in `crates/pairofcleats-tui/Cargo.toml`
- lockfile required: `crates/pairofcleats-tui/Cargo.lock`
