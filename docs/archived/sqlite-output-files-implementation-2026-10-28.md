# SQLite output size and failed-stage cleanup — 2026-10-28

Source `3f5d80543c2d6255eed86c7dbe6652a60592c410`, tree
`897e694a870198845e91f0735e5bae53b62d7a4c`, branch
`codex/pr557-audit-repairs-20261012`. Local, unpublished and functionally unqualified.

The incremental runner suppressed every output stat failure and reported zero
bytes, while full builds also coerced an invalid/missing size into zero. Both
now require the actual regular file's nonnegative safe integer byte observation.
Unsettled metadata and size-access inspection failures propagate through the
existing operation owner. A successful measured zero remains zero. Failed
observation cannot publish a successful zero-byte readiness report.

Failed-stage cleanup previously read unlink error codes before original resource
settlement and discarded successful removal observations. A pending ENOENT could
therefore admit sidecar deletion. The extracted actual runner owner now checks
original work, admits only its actual absolute stage path, confirms main removal
or benign absence, then joins existing sidecar retirement. Pending work/main
unlink retains the stage family. Exact original work/cleanup causes survive,
including frozen errors; falsey mode failures retain their cause when wrapped.
No root/category deletion authority is added.

Eighteen `storage/sqlite/build/output-file-ownership/*` controls cover measured
positive/zero/missing/error/invalid/directory/pending/inspected output, settled and
pending main/stage/sidecar cleanup, benign and pending ENOENT, frozen combined
failure, falsey original work, and actual native positive/error builds that keep
the indexed row while refusing failed output observation. Fixtures retain real
operation/category leases and assert metadata recovery does not repeat stat or
unlink. **All controls and affected existing fixtures are unexecuted.** The
original incremental/native/WAL/SHM/finalizer fixtures retain their assertions.

Format/ESLint, three JavaScript syntax checks, static inventory and whitespace
checks passed; shared-module analysis found zero cycles. No native operation,
functional fixture, child or publication gate ran. Dependencies are unchanged.
#1267/#1574 retain custom producer/publication/deletion integration, remaining
legacy/backend routes and current-candidate native/Windows/CLI/MCP qualification.
