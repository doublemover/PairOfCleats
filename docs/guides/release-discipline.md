# Release discipline

This document defines release rules for schema changes, flag removals, and changelog enforcement.

## Output schema versioning
- Backward-compatible additions (new fields, optional metadata) require a minor version bump.
- Breaking changes (field removals, semantic changes, renamed fields) require a major version bump.
- Update `docs/contracts/search-contract.md` and any API/MCP contracts alongside output changes.

## Artifact schema versioning
- Any change that makes existing artifacts unreadable requires a major version bump.
- Increment artifact schema versions in `docs/contracts/artifact-contract.md` and the corresponding writers/readers.
- Changes that only add optional fields may ship as a minor version bump, but must document the new fields.

## CLI flag removals/renames
- Deprecate flags first (warn on use) for at least one minor release.
- Removals or renames are breaking changes and require a major version bump.
- Update `docs/config/deprecations.md` and CLI help text when changing flags.

## Changelog enforcement
- Maintain `CHANGELOG.md` with entries per release.
- Breaking changes must be listed under `### Breaking` for the release section.
- Run `node tools/release-check.js --breaking` for breaking releases to enforce the changelog entry.

