# Owned service and continuation closure

Status: source implementation, unvalidated (2026-10-22).

Native API, MCP, indexer and semantic continuation controls address the exact
objects started by the current session. Their existing job, queue claim and lease
owners retain execution authority. Status discovery and a printed PID never grant
permission to stop a process.

Workflow reset and final disposal attempt all session owners and await every
admitted close before returning errors. A maintenance closer's rejection cannot
skip API/MCP/indexer/continuation cleanup. The first execution error remains the
cause and error code if cleanup also fails.

An MCP close is shared while pending. A failed close retains the exact client and
its per-scope admission slot, with `phase=closure-failed` and `closeErrorCode`.
Only a successful close of that same client removes it. A later disposal can retry
that owner; it cannot substitute a discovered process or replace its identity.

Semantic public continuation capabilities disappear immediately when close starts.
The process remains privately tracked, counted against the four-process bound,
and visible as `closurePending` until its close actually succeeds. A failed close
retains the slot and diagnosis. A response arriving after disposal started cannot
commit a new page or resurrect a continuation. Native disposal waits for those
retained closing processes as well as currently usable continuations.

Authored fixtures use injected process/protocol owners for rejected and delayed
teardown, late page response, admission during closure, exact-client recovery and
primary-error preservation. No test, syntax check, Rust build, live service,
terminal or native platform acceptance ran during this source span.
