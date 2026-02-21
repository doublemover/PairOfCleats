# Repository Guidelines

## You are working in PowerShell 7.5
- Avoid bash-style heredocs (`<<EOF`) or use python
- Quoting: use single quotes for literal strings, double quotes only when you need `$env:VAR` or `$(...)` expansion.
- Escaping: PowerShell uses backtick `` ` `` (not `\` or `^`) to escape inside double quotes. 
	- In single quotes, escape a `'` by doubling it (`''`).
- Avoid unquoted paths with spaces, Wrap in single quotes when no expansion is needed.
- JSON/CLI args: prefer single-quoted JSON (`'{"k":"v"}'`) to avoid accidental expansion
	- If you must use double quotes, escape `$` as `` `$ ``.
- Paths: use `C:\...` or `.\relative\path`; 
	- You generally do not need to escape backslashes.
- Here-strings (heredocs):
	- `@"` ... `"@` for expandable
	- `@'` ... `'@` for literal

## Project Structure & Module Organization
- `src/` contains the core library (indexing, retrieval, storage, config, shared utilities).
- `bin/` hosts the CLI entrypoint (`bin/pairofcleats.js`).
- `tools/` includes setup, bootstrapping, indexing, and maintenance scripts.
- `tests/` contains the JS test suite and fixtures; lanes are organized by filename prefix (e.g., `smoke-*`, `sqlite-*`).
- `docs/` holds technical references & schemas.
- `extensions/` and `sublime/` contain editor/IDE integrations.
- `assets/`, `benchmarks/`, and `rules/` hold supporting data, benchmarks, and lint rules.

## Build, Test, and Development Commands
- `npm install` installs dependencies.
- `npm run setup` or `pairofcleats setup` runs guided setup (models, tooling, cache).
- `npm run bootstrap` performs a non-interactive setup.
- `npm run build-index` builds an index; `npm run watch-index` rebuilds on changes.
- `npm run search` runs the search CLI locally.
- `node bin/pairofcleats.js <command>` runs the CLI from source.
- `npm run lint` checks style; `npm run format` auto-fixes via ESLint.
- Important Note: The script should be setting `PAIROFCLEATS_TESTING=1`, or other `PAIROFCLEATS_TEST_*` env vars will be ignored.
	- There is a helper you can import to handle this boilerplate.

## Script Policy References
- `docs/tooling/script-inventory.json` (generated inventory)
- `docs/guides/commands.md` (generated commands list)

## Spec deprecation + archival process
- Move deprecated or superseded spec docs to `docs/archived/` (do not delete them).
- Preserve the original filename whenever possible.
- Add a DEPRECATED header block at the top of the archived file with:
  - the canonical replacement doc(s)
  - the reason for deprecation
  - the date and PR/commit
- Contracts in `src/contracts/**` remain authoritative; specs must be updated to match them.

## Coding Style & Naming Conventions
- JavaScript, ESM (`"type": "module"` in `package.json`).
- Indentation: 2 spaces; try to keep files under ~1200 lines (ESLint `max-lines`).
- Prefer descriptive, hyphenated test filenames (e.g., `sqlite-bundle-missing.js`).
- Run `npm run format` before committing. 

## Testing Guidelines
- Primary runner: `node tests/run.js`.
- Lanes: `node tests/run.js --lane smoke`, `--lane unit`, `--lane ci-lite`, `--lane ci`, `--lane ci-long`, `--lane gate`, `--lane services`, `--lane api`, `--lane storage`, `--lane perf`, `--lane mcp`, `--lane backcompat`, `--lane diagnostics-summary`.
- List tests: `node tests/run.js --list`.
- Tests are plain Node scripts; add new tests under `tests/` and follow existing naming patterns.
- If a test runs longer than 30 seconds, cancel it and move on to the next test
- Once all tests have been run, report back with which ones passed and which you skipped

## Commit & Pull Request Guidelines
- Commit history does not enforce a strict format; Use descriptive yet concise titles and comprehensive lists in summary.

## Roadmap & Phase Tracking
- Roadmaps (e.g., `GIGAROADMAP.md`) contain current work plans.
- `AINTKNOWMAP.md` is the authoritative active roadmap sequence for current hard-cutover execution.
- When working on a phase, mark it as in progress, update as you go.
- When writing status log entries or marking when something was last changed, use ISO 8601 timestamps instead of just the date
- Checkboxes should be completed only at the same time you commit the work that completes them.
- Test checkboxes cannot be checked until the test has run and passed.
- If fixing a failing test, log each attempted fix as sub-details under that test’s checkbox.
- After 3 failed fix attempts, stop and log the failure, what was tried, and the next best fix
- Move on to the next test until no tests remain and you are out of attempts
- If a tiny post-commit update is needed (e.g., updating roadmap checkboxes), amend instead of commiting unless you are explicitly told not to.
- When all tasks in a phase are complete and concerns addressed: 
	- Remove that phase and append it to `COMPLETED_PHASES.md` blindly
	- Do not look inside `COMPLETED_PHASES.md` or worry about ordering, it is a dump file.
- Hard cutover policy is mandatory for roadmap execution:
	- Keep one active behavior per surface; do not keep compatibility shims or dual-write/dual-read paths after a phase cutover.
	- Remove superseded flags/paths/contracts in the same phase where replacement behavior is introduced.
	- Keep specs/tests in lockstep with the active behavior in the same change set.

