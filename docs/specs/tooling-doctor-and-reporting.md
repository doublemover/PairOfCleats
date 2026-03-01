# Spec: Tooling doctor (current)

> Purpose: emit a single, actionable tooling health report (TypeScript/LSP providers + chunkUid prerequisites) without forcing users to read raw logs. This doc reflects current behavior in `src/index/tooling/doctor.js`.

## 1) Report artifact

Written to `<buildRoot>/tooling_report.json`.

```ts
export type ToolingReport = {
  generatedAt: string;
  repoRoot: string;
  buildRoot: string;

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
      required: boolean;
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
    requires: { cmd?: string } | null;
    languages: string[];
    capabilities: Record<string, any>;
    status: 'ok'|'warn'|'error';
    checks: Array<{ name: string; status: 'ok'|'warn'|'error'; message: string; details?: any }>;
  }>;

  summary: {
    status: 'ok'|'warn'|'error';
    warnings: number;
    errors: number;
  };
};
```

Notes:
- `providers[]` is sorted by `id` at the end of the run.
- `scm.annotateEnabled=false` when `provider=none`.

## 2) Identity prerequisite checks

- `chunkUid` requires an xxhash backend.
- `getXxhashBackend()` sets:
  - `identity.chunkUid.available` and `identity.chunkUid.backend`
  - `xxhash.backend`, `xxhash.module`, `xxhash.ok`
- If backend is missing:
  - `identity.chunkUid.notes` includes a failure note
  - `summary.errors += 1`
  - **strict mode** throws after report write

## 3) SCM provenance snapshot

The doctor uses `resolveScmConfig` + `getScmProviderAndRoot` and then attempts `getRepoProvenance`.

- On errors, `scm.error` is populated and provider falls back to `none`.
- `scm.head` and `scm.dirty` are best-effort fields from the provider.
- `annotateEnabled` is false when provider is none (or annotate disabled in config).

## 4) Provider checks (current)

Provider selection is driven by `listToolingProviders(toolingConfig)` and optional `providerIds` filter.

### 4.1 Disabled/Enabled gating

Reasons in `reasonsDisabled`:
- `disabled-by-config` (in `disabledTools`)
- `not-in-enabled-tools` (when `enabledTools` is set and provider not listed)

### 4.2 TypeScript

- Resolve TypeScript module via `toolingConfig.typescript.resolveOrder` (repo/cache/tooling/global).
- Warn when `ts.version < 4.8.0`.
- If `useTsconfig !== false` and `tsconfigPath` is set, ensure it exists.
- If `allowJs`, `checkJs`, or `includeJsx` are disabled, emit a warning for JS parity.

### 4.3 clangd

- If `clangd.requireCompilationDatabase` is true, check for `compile_commands.json` in:
  - explicit `compileCommandsDir` or common fallbacks (`repo`, `build/`, `out/`, `cmake-build-*`).
- Verify `clangd` binary is runnable.

### 4.4 pyright

- Resolve `pyright-langserver` (repo/tooling/global) and verify it is runnable.

### 4.5 sourcekit

- Verify `sourcekit-lsp` binary is runnable.

### 4.6 Generic providers

- If provider declares `requires.cmd`, check that binary is runnable.

## 5) Human-readable summary

The doctor logs one summary line:
- `[tooling] doctor: ok.`
- `[tooling] doctor: <N> warning(s).`
- `[tooling] doctor: <N> error(s), <M> warning(s).`

## 6) Tests

- `tests/tooling/doctor/emits-report.test.js`
- `tests/tooling/doctor/detects-missing-typescript.test.js`
- `tests/tooling/doctor/reports-xxhash-backend.test.js`
