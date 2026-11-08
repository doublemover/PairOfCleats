# Configured native reader ownership — 2026-10-28

Source `c6ddbea3b58224f6039aa04076d5cf6a56090f4f`, tree
`480e55f2606c243f6bd99b2a95d55e358d6777ba`, on
`codex/pr557-audit-repairs-20261012`. Unpublished and functionally unqualified.

#1574/#1267 still had a source gap: native-reader admission returned null for
every store outside the canonical repository cache. Actual SQLite/LMDB retrieval
and SQLite build probes now select a typed backend, mode and actual caller
generation identity where available. Only an exact effective configured path or
the backend's fixed children of its configured `dbDir` may join the existing
storage lifetime owner. Markers, matching filenames and arbitrary external
parents cannot register a reader.

SQLite pins its provider-owned containing namespace and exact database/WAL/SHM/
journal family; LMDB pins the selected store directory. The containing SQLite
directory is an operational native namespace, not deletion authority over its
other contents. Volume-root namespaces remain unregistered. Metadata stays
under the actual launch-selected application state, without creating native
files in the selected location. Canonical admission now also resolves its cache
against the captured launch environment instead of an unrelated ambient default.

The existing storage session/native-reader owner captures these resources,
retains original closure and inspection prerequisites, blocks category exclusion
while live and releases metadata only after actual original settlement. Cached
SQLite handles keep one registration/hook per launch namespace. Source setting,
backend/mode and generation hash are immutable diagnostics. The generation is
explicitly caller-provided or unattested; no producer publication proof is
invented from a path or successful import. Locator/configuration selection is
rechecked before native work. No new public setting or CLI option is introduced.

Thirteen new authored cases cover SQLite/LMDB path/directory selection, sidecars,
changed selection, native/open failure, cache registration, distinct launch
homes, unknown roots and generation diagnostics. The existing actual SQLite
lifetime fixture gains five independent configured-store cases: uncached,
cached/warm reuse, metadata failure, admission exclusion and distinct launch
homes. Those preserve original native close capture and no repeated physical
close during metadata recovery. All **18 new cases remain unexecuted**; original
canonical cases also require affected qualification on the resulting candidate.

Static format/ESLint, changed JavaScript syntax, config budget, generated command
inventory and whitespace checks passed; shared-module analysis found zero cycles.
No functional fixture, child fixture, server, benchmark or publication front
gate ran during this implementation wave. Dependency inputs are unchanged from
the successful locked-bootstrap receipt in
[exact rendered tokens](context-token-budget-implementation-2026-10-28.md).

This advances reader adoption, not complete #1574 closure. Custom backend writer
admission, producer/publication registration, category-specific deletion and
requalification, unadopted legacy routes and complete all/multi-repository
CLI/MCP acceptance remain. Existing external cleanup stays protected/report-only.
No recursive user-cache deletion, permission change, symlink fixture or force
cleanup is added. Issues remain open pending their complete original/follow-up
acceptance.
