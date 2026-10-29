# Stable Python selection and portable runtime cleanup checks

October 29, 2026; implementation `4b55d6d69`, based on `516e29edf`. The adjacent
[receipt](python-stable-ci-2026-10-29.json) retains source hashes, original
failures, focused results and publication checks. Author-workspace `.tmp/` and
`.testLogs/` locations are historical, not files promised in a clean checkout.

All 18 native-bootstrap jobs select **Python 3.15.2**, the latest stable release
verified against the [official release](https://www.python.org/downloads/release/python-3152/)
and Actions interpreter inventory. `.python-version` owns the exact pin;
`actions/setup-python@v7` supplies the executable, and each bootstrap step binds
`NODE_GYP_FORCE_PYTHON` to that exact action output. This avoids silently selecting
a different Windows launcher interpreter. Workflow controls reject missing setup,
an unbound interpreter and prerelease admission. Local compatible Python remains
supported through the existing preflight contract.

Python AST workers now request hidden Windows processes. Their actual spawn
control verifies that option while retaining failed-kill, replacement and
original-close ownership checks. The AST worker fixture reuses the production
bounded executable probe instead of duplicating an unbounded synchronous probe
with the same command candidates and output check. Actual AST content, warnings
and shutdown assertions remain.

The hosted Windows authority run at `516e29edf` passes 30 fixtures, then fails a
stale single-wrapper assertion in `runtime-opened-byte-integrity`. The current
storage owner preserves both exact failures through nested error context. Its
portable database/evidence-close controls move intact into independently
scheduled `runtime-query-close-ownership`; the assertion now checks the exact
`operationError` and exact `cleanupErrors`. The original assertion fails locally
before repair; the repaired case passes. Physical-link and live-byte authority
controls remain in the original fixture and require hosted acceptance. No
production authority or error contract is relaxed.

Windows x64 qualification uses Node **26.13.0**, ABI **147**, and the official
signed Python **3.15.2** portable runtime. Existing native/patch readiness remains
valid. Preflight selects that interpreter and compiles/links its real toolchain
capability probe; this is not a fresh native rebuild with the new interpreter.
**13/13** focused Python, SDK and indexing cases pass; **2/2** cleanup/source
controls pass. Every fixture uses one job, a one-thread launch hint, 30-second
deadlines, zero retries and native-status redo disabled. Both historically hung
indexing fixtures pass fresh-cache controls, but their intermittent hosted hang
has not been attributed. The failed extraction attempt is retained separately
and is not used as regression proof.

All eight publication checks pass, including **40/40 gate fixtures**, with zero
failures, timeouts or skips. Source bytes and committed blob hashes are retained.
Hosted Windows at the prior head passes validate/search in 23.1 seconds and
snapshot creation in 22.5 seconds; build/search still times out. That original
log is retained for the next repair. Hosted CI and P1 #1288/#1574 acceptance stay
open; no full-suite pass is claimed.
