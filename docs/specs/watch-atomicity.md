# Phase 3 Watch Atomicity Spec (Draft)

## Goal
Ensure watch rebuilds are atomic, promotable, and do not corrupt current state.

## Attempt roots
- Each watch session uses a stable `sessionId` (`Date.now().toString(36)` + short UUID).
- Each rebuild uses a monotonic `attemptNumber` (zero-padded to 3 digits).
- Attempt build id: `<sessionId>-<attemptNumber>`.
- Attempt root: `<buildsRoot>/attempts/<attemptBuildId>/`.
- Attempt roots are never reused, even after failure.

## Promotion barrier
- Build artifacts into `attemptRoot`.
- Validate `attemptRoot` output (`validateIndexArtifacts`).
- Promote via `promoteBuild` only after validation success.
- Failures do not update the promoted build.

## Retention defaults
- Keep last 2 successful attempts.
- Keep last 1 failed attempt.
- Cleanup occurs when recording outcomes (never during an active attempt).
- Internal defaults only (no public config keys).

## Lock backoff
- Exponential backoff with jitter for lock acquisition.
- Defaults: base 50ms, max 2000ms, log interval 5000ms, max wait 15000ms.
- Log bounded retries (initial + periodic "still waiting" messages).

## Shutdown behavior
- Watch supports an `abortSignal` for clean shutdown in tests and automation.
- When shutdown is requested during a build, the active attempt is marked failed/aborted and the lock is released without promotion.

## Test hooks
- `watchIndex` accepts an optional `abortSignal` + `handleSignals=false` to avoid process signal handlers in tests.
- Dependency injection hooks (`deps`) allow stubbing watcher/build/validate/promotion for deterministic unit/E2E tests.

## Docs impact
- Update watch documentation to include attempt roots, promotion barrier, and retention defaults.
