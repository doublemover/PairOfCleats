# Current task-list reconciliation

Captured: 2026-10-02. Scope: this implementation branch, tracked task/status
documents, nonarchived checklist rows, and open GitHub issues. Canonical execution
status remains [the roadmap](roadmap.md).

## Implemented on this branch

- #513: typed graph witness endpoints and correct incoming symbol traversal.
- #514: semantic ANN free-text recall with explicit Boolean, phrase, negative,
  structured and lexical-only constraints preserved.
- #515: schema-valid runtime configuration, false/zero values and CLI precedence.
- #516: inferred provider dimensions before embedding cache identities/metadata.
- #517: truthful failed-child CLI outcomes and preservation of the current index.
- HTTP status/search/analysis diagnostic-path privacy with source content and
  local core contracts preserved at the corrected JSON boundaries.
- npm dependency remediation and the 150-alert Dependabot inventory reconciliation.
- Rust anyhow/lru/rand advisory remediation and required Rust 1.88 alignment.
- Documentation portability, cache isolation, platform-neutral artifact paths,
  release fixture expectations, vector encoding and SCM fixture isolation.

The open-issue query returned only #513–#517. Their implementations are on this
branch; this does not close issues or merge changes to the default branch.

## Existing implementation queues

The canonical roadmap already records Stage1 cutover, risk flows, snapshot/diff/
as-of retrieval, lexicon/retrieval, USR technical contracts, shared-module reduction
and the duplicate-code checkpoint as implemented. Current source and focused
regression owners support those surfaces. This work preserves that implementation.

- [Shared-module #432](tooling/shared-module-reductions/432-prioritized-implementation-backlog.md)
  explicitly has no implementation-ready batch remaining. Its JSON status was
  stale relative to its Markdown/canonical status; machine-readable status and
  a status-drift regression are reconciled in this checkpoint.
- [Duplicate reduction](tooling/duplication-reduction-status.md) requires a new
  concrete signal before further refactoring. Its old numeric baseline is not a
  current implementation backlog.
- [Fixture/search speed plan](../tests/FIXTURE_AND_SEARCH_TEST_SPEED_PLAN.md)
  records shared caching, locking, mode restriction, health stamps and in-process
  search as completed. Those helper paths exist in the current source.
- [Release validation plan](roadmap-release-validation-plan.md) defines evidence
  and release gates, not another feature implementation queue.

No additional confirmed implementation-ready feature batch remains in these
current task lists. New concrete defects can still create work; this is not a
claim that every possible defect has been eliminated.

## Unchecked-row audit

Before this documentation reconciliation, 60 nonarchived tracked Markdown files
contained 121 unchecked rows:

- 94 owner/backup-owner review rows across 47 USR language/framework documents.
  These are nontechnical reviews, not missing language implementations or actions
  performed by this branch. They remain unchecked.
- Six example/template rows in PR/release templates and the checklist guide.
- 21 suggested dependency-reference rows across ten package sheets. Most request
  benchmarks, platform validation, extraction checks or parity evidence. They do
  not establish missing implementation by themselves. Watcher fallback, document
  extraction/failure handling, native hash/regex/backend paths and their regression
  owners are already present.

The Transformers reference had a concrete documentation gap after migration:
its package name, links and cache/smoke pointers were stale. The retained legacy
sheet now documents the current package and existing tested integration. Its
three integration rows are closed with implementation/evidence pointers.

## Validation boundary

Existing receipts apply only to their recorded scope. See the
[embedding/HTTP report](security/embedding-http-validation-2026-10-02.json),
[Rust report](security/rust-dependency-validation-2026-10-02.json), and
[dependency inventory](security/dependabot-inventory-2026-10-02.json).

The broad ci-lite attempt was interrupted: 477 passes, two subsequently corrected
fixture failures, and seven timeouts during host resource pressure. It is not a
completed suite pass. Additional gate/CI campaigns, platform verification,
CodeQL analysis and performance campaigns are deferred from this implementation
pass. Final documentation edits have not triggered another suite run. This is an
implementation checkpoint, not a release-wide certification.

No merge, deployment, scanner-setting change or alert dismissal was performed.
