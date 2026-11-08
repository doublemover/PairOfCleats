# Configured native command ownership — 2026-10-28

Source `afa75fe93a76d2693036a74a774b6510f700d8d0`, tree
`e129b3ee94cb3ce8010232b8d55ce3cfa8d768b5`, branch
`codex/pr557-audit-repairs-20261012`. Unpublished and functionally unqualified.

The actual LMDB builder and SQLite compaction command already share one native
database lifetime owner. That owner now also admits exact effective configured
backend namespaces outside the canonical repository cache, through the same
configured selection/session owner used by retrieval and SQLite build operations.
Captured configuration/locator selection is revalidated before native creation;
failed revalidation blocks further native opens. Configured resource metadata
settles before enclosing canonical categories. Existing strict delegated-command
identity and canonical-path restrictions are preserved.

Source inspection also found an independent ownership defect: the native
command observer converted a thrown original observer into a transient false,
discarding the independently thrown error. A later true primary observation
could therefore hide another pending owner. Native commands now use the shared
captured observation/composer, retain the exact original receiver and independent
inspection errors, and expose their original failures in the retained diagnostic
graph. The observer helper reports whether it captured an ownership observation
without resampling getters; ordinary errors do not consume the bounded resource
observation inventory. Metadata reconciliation does not repeat native close.

Six authored controls cover mutable/frozen/callable original failures, changing
callback getters, a caught admission inspection and an unknowable marker getter.
They use actual disposable metadata and zero native handles. Five new actual
SQLite/LMDB command controls cover configured SQLite, configured LMDB, admission
exclusion, metadata failure and primary-plus-metadata failure. Existing native
close capture, data round trip and exact-once physical close assertions remain.
Configured/canonical reader, build-dispatch and command cases now use their full
case IDs for distinct isolated caches, avoiding sibling-case cache collisions.
All **11 new cases remain unexecuted**, and existing affected controls require
qualification on the resulting candidate.

Static format/ESLint, changed JavaScript syntax, config budget, command inventory
and whitespace checks passed; shared-module analysis found zero cycles. No
functional fixture, child fixture, native campaign, benchmark or publication
front gate ran. Dependency inputs remain unchanged from the successful locked
bootstrap in [exact rendered tokens](context-token-budget-implementation-2026-10-28.md).

#1267/#1574 remain partial. Full original/follow-up native/category/route
qualification, remaining legacy/other-backend lifetimes, artifact producer and
publication registration, backend-specific cleanup/requalification and complete
all/multi-repository CLI/MCP acceptance remain. Lifetime leases and caller
generation labels grant no deletion proof; custom cleanup remains protected.
The unknowable synthetic observer control asserts explicit non-settlement and
admits no filesystem/native resource; it is not a successful cleanup claim.
