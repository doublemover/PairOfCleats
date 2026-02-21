# Release Discipline

This guide defines the canonical release validation contract.

## Canonical command

Run release validation with:

```bash
npm run release-check
```

The command executes `tools/release/check.js` and always writes:

- `release_check_report.json`
- `release-manifest.json`
- `docs/tooling/doc-contract-drift.json`
- `docs/tooling/doc-contract-drift.md`

Both artifacts use ISO-8601 timestamps and stable schema/order.

## Required release-check flow

Release-check is strict and deterministic. Required checks cannot be skipped.

Execution order:

1. changelog validation for the current package version
2. contract/spec drift gate (`tools/docs/contract-drift.js --fail`)
3. Python toolchain policy gate (`tools/tooling/python-check.js`)
4. smoke sequence in fixed order:
   - `pairofcleats --version`
   - fixture index build
   - fixture index validate (`--strict`)
   - fixture search
   - editor package smoke checks (Sublime then VS Code)
   - TUI artifact manifest smoke check
   - service-mode smoke check

## Breaking release mode

For breaking releases:

```bash
npm run release-check:breaking
```

This requires a non-empty `### Breaking` section for the current version in `CHANGELOG.md`.

## Removed permissive modes

Blocker-related flags are unsupported (`--blockers-only`, `--no-blockers`, `--allow-blocker-override`, `--override-id`, `--override-marker`).

## Python policy

Python is a required runtime dependency for active tooling flows that package or validate Sublime integrations. Enforce availability with:

```bash
npm run python:check
```

Core release tooling fails fast when Python is unavailable.

## Versioning policy

- Breaking output/schema behavior requires a major version bump.
- Contract and spec updates ship in the same change as behavior updates.
- Artifact readers/writers and contract docs must stay aligned.
