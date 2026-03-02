# Spec: Tooling Doctor And Reporting (Current)

Purpose: emit one actionable tooling health report (providers, runtime prerequisites, preflight capabilities, chunkUid prerequisites) without requiring raw-log inspection. This reflects current behavior in `src/index/tooling/doctor.js`.

## 1) Report Artifact

Written to `<buildRoot>/tooling_doctor_report.json`.

```ts
export type ToolingDoctorReport = {
  schemaVersion: number;
  generatedAt: string;
  repoRoot: string;
  buildRoot: string;
  reportFile: 'tooling_doctor_report.json';
  reportPath?: string;

  config: {
    enabledTools: string[];
    disabledTools: string[];
  };

  xxhash: {
    backend: 'native'|'wasm'|'none';
    module: 'xxhash-native'|'xxhash-wasm'|'none';
    ok: boolean;
  };

  identity: {
    chunkUid: {
      required: true;
      available: boolean;
      backend: 'native'|'wasm'|'none';
      notes: string[];
    };
  };

  scm: {
    provider: 'git'|'jj'|'none';
    repoRoot: string | null;
    detectedBy: string | null;
    head: object | null;
    dirty: boolean | null;
    annotateEnabled: boolean;
    error: string | null;
  } | null;

  providers: Array<{
    id: string;
    version: string | null;
    enabled: boolean;
    available: boolean;
    reasonsDisabled: string[];
    requires: { cmd?: string, args?: string[] } | null;
    languages: string[];
    capabilities: Record<string, unknown>;

    preflight: {
      supported: boolean;
      id: string | null;
      hasCustomKey: boolean;
      class: 'probe'|'workspace'|'dependency'|null;
      policy: 'required'|'optional'|null;
      runtimeRequirements: Array<{
        id: string;
        cmd: string;
        args: string[];
        label: string;
      }>;
      timeoutMs: number | null;
    };

    command?: object;
    handshake?: object;
    runtimeRequirements?: Array<{
      id: string;
      command: string;
      profile: object;
    }>;

    status: 'ok'|'warn'|'error';
    checks: Array<{ name: string; status: 'ok'|'warn'|'error'; message: string; details?: unknown }>;
  }>;

  summary: {
    status: 'ok'|'warn'|'error';
    warnings: number;
    errors: number;
    preflight: {
      supported: number;
      enabled: number;
      withCustomKey: number;
      withRuntimeRequirements: number;
      byClass: Record<string, number>;
      byPolicy: Record<string, number>;
      ids: string[];
    };
  };
};
```

Notes:
- `providers[]` is sorted by provider `id`.
- `summary.preflight.ids` is deduped + sorted.
- `scm.annotateEnabled=false` when `provider=none`.

## 2) Identity Prerequisite Checks

- `chunkUid` requires an xxhash backend.
- `getXxhashBackend()` sets:
  - `identity.chunkUid.available` and `identity.chunkUid.backend`
  - `xxhash.backend`, `xxhash.module`, `xxhash.ok`
- If backend is missing:
  - `identity.chunkUid.notes` includes a failure note
  - `summary.errors += 1`
  - strict mode throws after report write

## 3) SCM Provenance Snapshot

Doctor uses `resolveScmConfig` + `getScmProviderAndRoot`, then attempts `getRepoProvenance`.

- On errors, `scm.error` is populated and provider falls back to `none`.
- `scm.head` and `scm.dirty` are best-effort fields from provider provenance.
- `annotateEnabled` is false when provider is `none` or annotate is disabled.

## 4) Provider Checks

Provider selection is driven by `listToolingProviders(toolingConfig)` and optional `providerIds` filtering.

### 4.1 Enabled/Disabled gating

`reasonsDisabled` values:
- `disabled-by-config`
- `not-in-enabled-tools`

### 4.2 Command + handshake probes

- Provider commands are resolved via command-profile resolution.
- Dedicated/configured LSP-like providers optionally run initialize-handshake probes.
- Runtime requirement command checks run for each requirement profile.

Runtime requirements are resolved in this order:
1. Provider-declared `preflight.runtimeRequirements` metadata.
2. Legacy command-token mapping fallback in doctor.

### 4.3 Preflight metadata surface

For providers with `preflight` support, doctor reports:
- `preflight.id`
- `preflight.class` (`probe|workspace|dependency`)
- `preflight.policy` (`required|optional`)
- `preflight.runtimeRequirements[]`
- `preflight.timeoutMs` when configured

Doctor also emits one `ok` check per provider indicating preflight registration and metadata.

## 5) Human-readable summary logging

Doctor logs exactly one final status line:
- `[tooling] doctor: ok.`
- `[tooling] doctor: <N> warning(s).`
- `[tooling] doctor: <N> error(s), <M> warning(s).`

## 6) Related preflight reporting surfaces

- Orchestrator emits canonical preflight summary lines:
  - `total`, `cached`, `timedOut`, `failed`, `queuePeak`, `teardownTimedOut`
  - aggregate maps: `states`, `classes`, `policies`
- Bench language report parser consumes these summary lines and rolls up:
  - `countsByState`, `countsByClass`, `countsByPolicy`

## 7) Tests

- `tests/tooling/doctor/emits-report.test.js`
- `tests/tooling/doctor/command-resolution-report.test.js`
- `tests/tooling/doctor/preflight-capabilities-report.test.js`
- `tests/tooling/doctor/preflight-capabilities-configured-gopls.test.js`
- `tests/tooling/doctor/preflight-capabilities-configured-rust.test.js`
- `tests/tooling/lsp/preflight-provider-metadata-coverage.test.js`
- `tests/tooling/reports/bench-language-preflight-summary-report.test.js`
