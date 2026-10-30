# Runtime worker cleanup admission

The Windows scope, initialization and category-session controls have passing
observations on Node 26.12.1. Whole-suite and other-platform qualification remain
separate; durable source identities belong in the linked repair receipts.

Worker pool selection and destroy-method capture occur inside the existing
bounded runtime teardown step. A throwing owner/method getter is a cleanup
failure; it cannot skip logger, parser, replay, cache-writer or subprocess
cleanup, or bypass retention of the actual runtime storage owner. One selected
pool and its original destroy method/receiver are used together. The ordinary
plural pool and legacy singular fallback remain supported, in their existing
scheduler-before-workers order and cleanup deadline.

Each build runtime carries an internal resource scope through its logger's run
context. Teardown stops admission, shuts down its scheduler and worker groups,
reaps its exact Stage1/preflight children, then drains accepted operations and
releases its parser/LSP references. Initialization registers these owners as
acquired and unwinds them in reverse order, including final receipt failure.

Immutable parser policies share a pool across runs. A run releases its own
reference; the last reference invokes the existing native disposal owner.
Process-owned caches remain independent. Shared child execution has its own
tracking scope, so a creator file's timeout cannot claim a cached Python worker
or LSP session. Pool/session views reject new work after their run closes;
already admitted creation remains owned while it finishes.

Python replacement waits for the original child close and retains failed tree
cleanup observations. Probe failures with pending ownership cannot become
"Python unavailable" or admit another probe before original settlement. A
timed-out disposal retains its actual component completion observer. A later
explicit acquisition may replace a confirmed retired component; it cannot
rewrite a failed outcome or repeat native disposal automatically.

When the runtime's exact cleanup deadline expires, it retains this scope's
original settlement observer. Generic cleanup timers still cannot manufacture
native closure. Late work and resource completion remain distinct from category
lease release; a later explicit teardown may reconcile confirmed retirement
without invoking the original native close again.

Coverage owners are `indexing/runtime/shared-resource-scope-isolation` (distinct
and shared workspaces, cancellation and hosted caches),
`indexing/runtime/initialization-resource-unwind` (actual Piscina work),
`shared/lifecycle/run-resource-scope`, `lang/python/pool-retirement-ownership`,
and `indexing/runtime/category-session-teardown`. The category-session control
also retains falsey getter failures and verifies later cleanup plus exact
plural/singular pool method receivers. Existing LSP disposal/admission,
preflight cancellation and Stage1 timeout controls retain their own coverage.
`indexing/runtime/run-resource-drain-timeout` covers bounded drain and explicit
category reconciliation after successful or failed original component close.
