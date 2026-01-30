# Repository Guidelines

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

## PowerShell 7.5 Notes
- Avoid bash-style heredocs (`<<EOF`) or use python
- You are working in PowerShell 7.5; Be mindful of how it is different.
- Quoting: use single quotes for literal strings, double quotes only when you need `$env:VAR` or `$(...)` expansion.
- Escaping: PowerShell uses backtick `` ` `` (not `\` or `^`) to escape inside double quotes. 
	- In single quotes, escape a `'` by doubling it (`''`).
- Avoid unquoted paths with spaces, Wrap in single quotes when no expansion is needed.
- JSON/CLI args: prefer single-quoted JSON (`'{"k":"v"}'`) to avoid accidental expansion
	- If you must use double quotes, escape `$` as `` `$ ``.
- Paths: use `C:\\...` or `.\\relative\\path`; 
	- You generally do not need to escape backslashes.
- Here-strings (heredocs):
	- `@"` ... `"@` for expandable
	- `@'` ... `'@` for literal

## Coding Style & Naming Conventions
- JavaScript, ESM (`"type": "module"` in `package.json`).
- Indentation: 2 spaces; keep files under ~1200 lines (ESLint `max-lines`).
- Prefer descriptive, hyphenated test filenames (e.g., `sqlite-bundle-missing.js`).
- Run `npm run format` before committing. 

## Testing Guidelines
- Primary runner: `npm test` (alias for `node tests/run.js`).
- Lanes: `npm run test:smoke`, `test:unit`, `test:integration`, `test:services`, `test:storage`, `test:perf`, `test:ci`.
- List tests: `npm run test:list`.
- Tests are plain Node scripts; add new tests under `tests/` and follow existing naming patterns.
- If a test runs longer than 30 seconds, cancel it and move on to the next test
- Once all tests have been run, report back with which ones passed and which you skipped

## Commit & Pull Request Guidelines
- Commit history does not enforce a strict format; Use descriptive yet concise titles and comprehensive lists in summary.

## Roadmap & Phase Tracking
- Roadmaps (e.g., `GIGAROADMAP.md`) contain current work plans.
- When working on a phase, mark it as in progress, update as you go.
- Checkboxes should be completed only at the same time you commit the work that completes them.
- Test checkboxes cannot be checked until the test has run and passed.
- If fixing a failing test, log each attempted fix as sub-details under that test’s checkbox.
- After 3 failed fix attempts, stop and log the failure, what was tried, and the next best fix
- Move on to the next test until no tests remain and you are out of attempts
- If a tiny post-commit update is needed (e.g., updating roadmap checkboxes), amend the previous commit instead of creating a new one, unless you are explicitly told not to amend.
- When all tasks in a phase are complete and concerns addressed, remove that phase and append it to `COMPLETED_PHASES.md` blindly (do not look inside it or worry about ordering, it is a dump file)