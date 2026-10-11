# Repository Guidelines

## Working environment and bootstrap
- Check the authorized checkout, `git status` and current branch before editing. Preserve unrelated changes and active indexing jobs.
- Use the actual shell. On Windows/PowerShell 7.5, quote paths, prefer single-quoted literals/JSON and use here-strings, not Bash heredocs. Cloud/Linux shells are not necessarily PowerShell.
- Use Node **26.x** (`package.json` engines); `.nvmrc` supplies the exact CI pin. Check `node --version` before setup or tests. Read scoped `AGENTS.md` and relevant `.agents/skills` when present.
- From the repository root, run **`npm run bootstrap:ci`** for fresh/incomplete/stale setup: lockfile install including dev dependencies, required patches, native rebuild/verification and readiness receipt. `npm run bootstrap` uses `npm install`; reserve that alternative for intended dependency-resolution changes.
- Native source builds need Python 3 and a C/C++ toolchain. Use writable task-owned caches and official Node headers when explicit paths are needed; report setup failures.
- Plain `npm ci`, native imports or marker existence do not prove readiness. Normal/test/benchmark entry points enforce `BOOTSTRAP REQUIRED`; do not bypass it, forge receipts or silently switch backends.
- Already prepared dependencies can use `node tools/setup/rebuild-native.js --verify` to verify natives/patches and refresh readiness. It cannot repair missing patches. Only dependency-free bootstrap diagnostics may run directly to diagnose an unprepared checkout.

## Project structure and authoritative contracts
- `src/`: library owners; `bin/`: CLI; `tools/`: setup/indexing/maintenance; `tests/`: plain Node-script fixtures; `docs/`: contracts and guides.
- `extensions/` and `sublime/`: editors; `assets/`, `benchmarks/`, `rules/`: supporting inputs/tooling.
- `src/contracts/**`, validators and schemas are authoritative. Fixtures must use canonical version constants such as `ARTIFACT_SURFACE_VERSION`, not missing/stale format identities.
- Reuse existing scheduler, replay journal, lease and publication-recovery owners. When semantic producer behavior changes, update the affected shared version in `src/index/semantic/analysis-versions.js` so derived replay cannot silently reuse old meaning.
- Script references: `docs/tooling/script-inventory.json`, `docs/guides/commands.md`; test selection/lanes: `docs/testing/test-runner-interface.md` and `tests/run.rules.jsonc`.

## Coding and focused checks
- JavaScript is ESM (`"type": "module"`), two-space indentation. Prefer descriptive hyphenated test filenames; keep files under the ESLint `max-lines` limit (~1200 lines).
- Run **`npm run format` before committing**. It runs ESLint with fixes; inspect the diff and do not stage unrelated rewrites.
- Use `node tests/run.js --lane all --match <test-id> --jobs 1 --timeout-ms 30000 --retries 0` for an affected fixture. List candidates with `node tests/run.js --lane all --list`; avoid an unfiltered `--lane all` run.
- Use helpers in `tests/helpers/test-env.js` for `PAIROFCLEATS_TESTING=1`; otherwise test-only environment overrides are ignored.
- Stop/report tests over 30 seconds. Retries, skips and larger deadlines are not passing evidence. After a fix, rerun affected cases rather than repeated broad campaigns.
- Full indexes, benchmarks, native crash investigations and release qualification need task-specific scope; ordinary implementation uses small regressions.

## Cheap pre-push gate
After bootstrap, run this existing front gate **once for the ready-to-publish batch**, in addition to affected feature tests. It catches config, generated-document, workflow and core-contract drift before waiting for hosted CI:

```text
npm run format
npm run config:budget
npm run env:check
node tools/docs/generated-surfaces.js --check-freshness
node tools/ci/check-command-surface.js
node tests/ci/workflow-contract.test.js
node tests/run.js --lane gate --timeout-ms 30000 --retries 0
git diff --check
```

- Stop on a failure, fix its actual cause and rerun that check. Report any check blocked by the environment; do not claim the gate passed. If behavior changes after a check, rerun affected checks against the final code.
- `npm run format` already performs the ESLint pass; hosted CI also runs `npm run lint`. The `gate` lane alone does **not** include every preceding command.
- This excludes platform/Rust, broader integration, optional-backend and performance acceptance. `npm run verify` is much broader; do not substitute it automatically.

## Generated docs and status hygiene
- `docs/roadmap.md` is the single active source for status, execution order and remaining work. Keep it under its existing 20 KB contract; retain detailed completed receipts in `docs/archived/`, linked from the active summary.
- Archive superseded specs instead of deleting them; preserve filenames where possible. Add a DEPRECATED header with replacement, reason, date and PR/commit. Do not revive competing root roadmap files.
- Update docs with schema/CLI changes. Refresh affected generated output using `docs/tooling/generated-surfaces.json`, then check freshness; do not hand-edit generated reports or weaken drift checks.
- For a new public knob, update the config allowlist/budget only as an explicit reviewed surface change with purpose/default/tests. The count is maintenance governance, not a runtime/security boundary.
- Label author-workspace `.testLogs`/`temp/` receipts historical. Preserve provenance; do not promise them in clean checkouts or fabricate evidence.

## Commits and publication
- Make granular, descriptive commits. Stage only task-owned source/docs/generated outputs, never caches, credentials or temporary results.
- Before opening/retargeting a PR, check the requested integration branch, upstream, ancestry and relevant recent PRs/task history. Never default to `main`; ask when the destination is uncertain. A push/PR request does not authorize a merge.
- Honor publication approval and report a denied/cancelled action instead of using another route around it. Verify the remote branch SHA after a push and read back PR metadata before claiming publication.
- Report exact head, checks passed/failed/skipped, CI state and remaining scope. Earlier green runs are not final-head acceptance. Never restart active indexes or invalidate user caches without task authorization.
