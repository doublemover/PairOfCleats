# Production Readiness

This guide is the operator-facing checklist for deciding whether the repo is in
a releasable, supportable state.

## Core expectations

- CLI help, version, and JSON surfaces are stable and machine-safe.
- Service queue identity, shutdown, admission, and repair paths are deterministic.
- Runtime envelope settings reach heavy commands consistently.
- Config validation fails early with actionable errors.
- Build/index artifact promotion and fail-closed behavior are intact.
- API auth/status/startup behavior matches the docs.

## Recommended verification flow

Run these from the repo root:

```bash
npm run verify:production
```

That command is the production-readiness baseline and should stay green before release work.

## Manual operator spot-checks

### 1. Config

- validate the main repo config:

```bash
pairofcleats config validate --json
```

- validate the service config by invoking an indexer command with `--json`; invalid values should fail fast with a field path and hint.

### 2. Service

- confirm canonical queue status:

```bash
pairofcleats service indexer status --queue index --json
pairofcleats service indexer status --queue embeddings --json
```

- confirm shutdown and resume behavior:

```bash
pairofcleats service indexer shutdown --queue index --shutdown-mode drain --json
pairofcleats service indexer resume --queue index --json
```

- inspect repair state if queue behavior looks inconsistent:

```bash
pairofcleats service indexer inspect --queue index --json
```

### 3. API

- start locally on localhost with JSON startup output:

```bash
pairofcleats service api --json
```

- verify:
  - `/health` responds
  - `/status` matches repo/service expectations
  - auth behavior matches the binding mode

### 4. Build and search

- verify indexes can be built and searched with the expected backend/mode mix:

```bash
pairofcleats index build
pairofcleats search <query>
```

### 5. Release workflow

- run the release dry-run gate:

```bash
node tools/release/check.js --dry-run
```

- ensure current docs remain aligned:
  - `docs/guides/service-mode.md`
  - `docs/api/server.md`
  - `docs/config/env-overrides.md`

## Escalation guidance

- Config errors: fix the config and rerun; do not paper over them with defaults.
- Queue saturation or shutdown anomalies: inspect status, backpressure, and repair state before retrying jobs.
- Missing artifacts or fail-closed index errors: treat as build/promotion issues, not query-only issues.
- API auth or repo-root violations: treat as policy/config mismatches, not transient runtime noise.
