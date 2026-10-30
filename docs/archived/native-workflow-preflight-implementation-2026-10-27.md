# Native workflow admission and witnesses — 2026-10-27

Source `f6c82c945321492dcdbe5f12f09204cc5beee353`, tree
`06be5769bf91c057f205e68916169a7f84de0150`, branch
`codex/pr557-audit-repairs-20261012`. Functional/native checks remain deferred.

The hosted #635 failure reaches a completed `describe` response and then times
out waiting for obsolete rendered text. Commit `9add4524a` replaced both the
catalog-loaded and Enter-form labels; the fixture still awaited their previous
wording. The editor also changed to literal entry by default, with an explicit
`e` advanced-JSON action; its fixture still expected a nonexistent combined
field/JSON heading. These are established source/history mismatches, not an
inference from the last log line or permission to remove workflow coverage.

The fixture now uses the current rendered headings, explicitly opens advanced
JSON, and separately requires the exact field identity. It also requires complete
matching supervisor responses, a unique catalog containing the supported build
adapter, and no admitted work before an explicit launch. All original operation,
generation, search, cancellation, teardown and terminal-restoration assertions
remain. Deadlines, retries and execution boundaries are unchanged. The catalog
fix does not establish that the individual workflows now pass.

A distinct production bug allowed a native `index.stats` preview containing an
explicit `index-dir` even though the workflow binds `repo`; the canonical CLI
rejects that combination after launch. The shared CLI option owner now validates
both paths, required input and mode spelling for the CLI, argv construction,
preview and fresh pre-run inspection. Existing mode normalization/error text and
public options remain. Invalid argv construction now returns a blocked preview;
pending original cleanup continues propagating its ownership observer.

Three canonical CLI negative cases and a native keyboard/ConPTY stats-conflict
case are authored, unexecuted. Existing actor/catalog fixtures add invalid-mode,
scope-conflict, no-launch and valid argv controls; original positive stats
artifact/checksum assertions remain. #635 is open for all 19 actual native cases
and related operator/supervisor/index contracts on the resulting candidate.

Format/ESLint, changed-JavaScript syntax, config budget, generated command
inventory and whitespace checks passed. Shared module analysis found zero cycles.
No Rust/native binary was executed or rebuilt, no functional fixture ran, and no
platform qualification or final-tree pass is claimed.
