# Clangd compilation context implementation — 2026-10-27

**UNVALIDATED implementation:** source `342c39c7b05ce17e8750c93b3a47b9b23e631703`,
tree `efe1926c071bbf5fb22070ff5541563b86f4d181`, branch
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
This local checkpoint has no passing functional, native-clangd or hosted-CI
receipt. Execution remains deferred for the implementation wave.

## Delivered source

- One read-only compilation-database owner classifies missing, wrong-kind,
  unreadable, malformed, over-budget, empty, partially valid and usable inputs.
  It bounds database bytes/rows, physical source-path checks and response files.
  Recorded commands are data and are never executed by admission.
- Configured and actual launch-argument database selections agree. Invalid
  selection cannot choose an ambient replacement. Invalid/oversized databases
  block native dispatch with database diagnostics, rather than causing a server
  timeout or claiming absent symbols.
- Per-document exact/ambiguous/fallback/unknown coverage binds the selected
  command variant, working directory, physical source identity and response-file
  bytes. Identical variants deduplicate; nested/unavailable/opaque response
  closures remain unknown. Embedded or escaping sources cannot borrow exact
  context. Explicit compilation-database requirements need at least one exact
  requested document. Doctor distinguishes entries from selected-file coverage.
- Preflight shares its captured coverage with run. Revalidation checks original
  bytes/paths, documents and launch/configuration before planning and dispatch;
  changed context requires replanning. Healthy exact documents do not consume the
  existing weak-context cap. Only weak documents undergo deterministic reduction
  and weak hover policy; generic runtime/path budgets remain applicable.
- Exact source URIs are physical file URIs with LSP text overlays. They do not
  become unrelated VFS copies and do not rewrite source files. Weak and embedded
  documents retain existing VFS behavior. The existing sealed semantic-session
  URI owner retains precedence.
- Internal per-document hover policy is consumed by the actual LSP collector.
  Original explicit zero-cap/global-budget semantics remain. Request cache identity
  includes context; unknown/ambiguous context has an invocation identity. Provider
  version is 3.0.0 and shared `lspBindings` producer version is 52.
- Database/coverage and request-plan diagnostics reconcile counts and document
  identities. Stderr finalization preserves primary collection and cleanup errors.

## Authored coverage and static observations

Authored, not executed: 25 `tooling/lsp/compilation-database-admission` cases and
`tooling/lsp/document-context-hover-policy`. The former runs actual provider
admission/planning with a declared fixture collector and fixture command/trust;
it does not execute a compiler or qualify native clangd. Cases include all input
classes, mixed exact/weak documents, identical/conflicting variants, explicit and
argument-selected databases, response closure/change, source replacement/escape,
required coverage and launch changes. Assertions inspect dispatched identities,
targets, hover limits, source URIs and blocked dispatch.

The collector fixture is authored to use a real bounded Node LSP fixture server,
asserting one healthy hover, zero weak hover, physical/VFS routing, unchanged
source bytes and shutdown. It has not been run. The existing three-document
weak-context fixture keeps every assertion and now explicitly selects test
environment and repository execution trust.

Completed static observations: ESLint format, JavaScript syntax, configuration
budget, whitespace and shared-module cycle analysis (zero cycles). No functional
fixture, benchmark, real tool installation or publication front gate was run for
this source. Current-source affected provider, LSP cache/URI/lifetime and semantic
replay checks, controlled earlier-owner failures and the front gate remain.

## Remaining issue acceptance

#289 remains open until the authored cases and existing positive/negative fixtures
pass and real Windows clangd reproductions demonstrate healthy contribution and
no repeated timeout storm. This application planner is not #1161's complete
native toolchain/SDK/translation-unit closure, nor #1146's installed command-profile
qualification. Other platforms remain outside the current Windows task.
No dependency, native binary, GUI, WSL, elevation, security setting, physical link
or user-cache cleanup changed. The active roadmap is the execution/status owner.
