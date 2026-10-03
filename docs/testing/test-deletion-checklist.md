# Test Deletion Checklist

Use this checklist whenever a standalone test is removed, merged into a matrix, or replaced by a new hero path.

## Required Follow-Up

- Update the owning replacement suite in [consolidation-ownership.json](./consolidation-ownership.json).
- Refresh lane manifests, lane evidence, and suite taxonomy with `npm run test:refresh-governance`.
- Verify smoke wrappers do not point at deleted test files.
- Verify script-coverage action files do not point at deleted test files.
- Verify active docs do not link to deleted tests or docs.
- Regenerate config inventory and shared-module ledger as part of the governance refresh.

## Keep Or Remove?

- Keep corruption, fail-closed, migration, and recovery tests isolated unless fixture reuse is enough to reduce cost without merging assertions.
- Keep one thin smoke/hero path per major subsystem.
- Prefer one heavy bootstrap per file and multiple assertions over multiple files with repeated setup.

## Before Closing A Reduction Issue

- Run the touched tests directly when they stay under the 30-second limit.
- If a touched test exceeds 30 seconds, stop it and record it as skipped under repo policy.
- Refresh the issue with the exact tests verified and the new setup strategy.
