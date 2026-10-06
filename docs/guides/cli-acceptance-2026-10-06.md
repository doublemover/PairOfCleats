# CLI and setup acceptance checkpoint

Recorded 2026-10-06. The [canonical roadmap](../roadmap.md) owns execution order
and remaining work. This record preserves the bounded completed checks.

The October 6 cloud pass inventories all 58 registered CLI routes and exercises
real commands on isolated repositories with embeddings disabled. It fixes strict
doctor flag defaults, navigation help, runnable graph examples, application-root
TUI build/install and MCP SDK detection, false-success parity reports, default
watch depth and CLI parent-signal child cleanup. Parity now requires a fresh,
structurally valid report and propagates failed children as a nonzero exit.
Focused regressions cover each correction; controlled Cargo fixtures do not
establish native Rust build or interactive rendering acceptance.
The complete Linux `ci-lite` checkpoint passes 813 tests with no failures,
timeouts or skips (Node 24.21.0, one worker, 30-second per-test deadline, 512 MiB
Node heap, 1 GiB aggregate process-family cap). This checkpoint predates the
separate SQLite compaction and broader generated-artifact follow-on batches.

Actual API, both MCP transports and the TUI supervisor pass repeated requests,
invalid requests and shutdown/cancellation controls. Snapshot freeze followed by
an index generation change preserves historical memory results. The subsequent
SQLite lifecycle pass exposed metadata loss in `sqlite compact`: its chunk INSERT
omitted `metaV2_json`, leaving new frozen snapshots unreadable by SQLite retrieval.
The corrected INSERT preserves every persisted chunk column. A regression covers
repeated compaction, reassigned local IDs, stable chunk identity, retrieval
hydration, backups and dry-run bytes. All 19 fresh CLI lifecycle checks pass,
including repeated live/historical searches on memory and SQLite after compaction,
snapshot freeze and a generation change. Previously damaged snapshots require
their own recovery; this fix does not rewrite historical artifacts. These
tiny, lexical-only fixtures do not establish ANN quality, optional backend
acceptance or complete project/platform coverage. Full benchmark measurement,
clean dependency installation and native interactive/platform acceptance remain
unverified by these fixtures. The watch steady-state fixture waits for startup
admission; a startup-ready race has not been ruled out. Parent-only cancellation
proves child termination, not graceful service flushing.

The invalid-option pass exercises all 58 registered routes. Sixteen routes now
reject unknown options in their owned parser before installation, report writing,
stdin ingestion or supervisor startup. The shared parser remains permissive for
unrelated tools; search retains its documented permissive default and explicit
`--strict-dispatch` validation contract. All 58 strict-option cases pass. Index
validation also accepts `--non-strict` without conflicting with its implicit
default, and parity accepts an explicit repository from an unrelated directory.
Closed setup input now fails with an actionable unattended-setup message instead
of Node's unsettled-top-level-await exit. The 33 affected CLI/ingestion/TUI/report
tests pass with no failures, timeouts or skips.
The subsequent ingest lifecycle regression captures spawn/error/close before
draining stdout, so missing dependencies and fast exits cannot strand an awaited
command. Failed stdout/stderr consumers terminate their owned child tree with
bounded reaping, and signal exits are failures rather than zero-code success.
The parity fixture is split into a real success/report case and deterministic
nonzero/missing/invalid-report controls to keep each test within 30 seconds.
The integrated `13136005` checkpoint passes 822/822 `ci-lite` and 35/35 gate tests,
with no failures, timeouts or skips under the same bounded Linux settings.
Actual repeated Git-worktree builds/searches remain isolated, a read-only config
destination fails with a permission error, and parent-only watch/indexer-service
cancellation terminates their children. These are Linux fixture results.

A follow-on failure-preservation check reproduced all four ingestion commands
truncating a previous output before rejecting missing input. Their output now
streams into an exclusive temporary file and is renamed into place only after
the producer and output stream succeed. Missing inputs/dependencies, nonzero
children and output errors preserve prior output and summary bytes; input/output
aliasing retains real rows. Eight focused ingest tests pass, including private-file
mode preservation and POSIX cancellation/staging cleanup. Output and summary are
separate publications, not a crash-atomic pair. Uncatchable termination may leave
a temporary file. Native Windows replacement/cancellation still needs proof.

The isolated follow-on checkpoint `0d3e37db` passes 831/831 `ci-lite` and 35/35
gate tests, with zero failures, timeouts or skips. It includes staged ingestion,
record-routing precedence, 15 audited object-cache families and strict visible
JSON-prefix validation. Peak process-family RSS was 988.55 MiB under the unchanged
1 GiB limit. These results do not establish native Windows/macOS acceptance.

The first generated-artifact batch moves map caches outside the indexed repository
by default and gives custom caches a portable, versioned ownership marker. Actual
build → map → rebuild fixtures preserve authored chunk counts, including custom
in-repository caches, legacy default caches and authored siblings. Discovery and
watch inspect only candidate filenames using one contained read capped at 8 KiB;
ordinary paths perform no marker reads. See the
[generated-artifact contract](generated-artifact-ownership.md).

The exhaustive producer inventory is an implementation queue, not blanket
exclusion authority. Continue in bounded batches: producer registry and action
contracts; index/storage manifests; caches/runtime state; reports/editor outputs;
then native/package/TUI/developer outputs. Useful reports remain searchable.
Strict schemas, JSONL/array row shapes, offsets, native headers, checksums and
snapshot hardlinks require producer-specific compatibility handling. Legacy
unmarked custom caches and unsupported external formats are explicit exceptions.
