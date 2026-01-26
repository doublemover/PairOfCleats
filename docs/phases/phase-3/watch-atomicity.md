# Phase 3 Watch Atomicity Spec (Draft)

## Goal
Ensure watch rebuilds are atomic, promotable, and do not corrupt current state.

## Attempt roots
- Each watch session uses a stable `watchSessionId` (timestamp + random suffix).
- Each rebuild uses a monotonic `attemptNumber`.
- Attempt build id: `<watchSessionId>-<attemptNumber>`.
- Attempt root: `<repoCacheRoot>/builds/attempts/<attemptBuildId>/`.
- Attempt roots are never reused, even after failure.

## Promotion barrier
- Build artifacts into `attemptRoot`.
- Validate `attemptRoot` output.
- Promote via `current.json` only after validation success.
- Failures do not update `current.json`.

## Retention defaults
- Keep last 2 successful attempts.
- Keep last 1 failed attempt.
- Cleanup occurs after a successful promotion (never during an active attempt).
- Internal defaults only (no public config keys).

## Lock backoff
- Exponential backoff with jitter for lock acquisition (50ms -> 2s max).
- Log bounded retries (first retry, then ~every 5s).

## Shutdown behavior
- Watch supports a programmatic abort signal for clean shutdown in tests and automation.
- When shutdown is requested during a build, the active attempt is marked failed/aborted and the lock is released without promotion.

## Test hooks
- `watchIndex` accepts an optional `abortSignal` + `handleSignals=false` to avoid process signal handlers in tests.
- Dependency injection hooks (`deps`) allow stubbing watcher/build/validate/promotion for deterministic unit/E2E tests.

## Docs impact
- Update watch documentation to include attempt roots, promotion barrier, and retention defaults.
