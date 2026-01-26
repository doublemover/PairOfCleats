# Phase 8 -- Tooling Doctor + Reporting (Refined)

> **Purpose:** Provide a single, actionable health report for tooling providers (TypeScript, LSP) and identity prerequisites (chunkUid readiness), so failures are diagnosable without reading raw logs.

This refinement adds:
- explicit checks for **identity prerequisites** (chunkUid hashing backend availability)
- explicit reporting of **virtual document routing support** per provider

---

## 1. Goals

1. Detect missing / misconfigured tooling dependencies before expensive runs.
2. Emit a machine-readable report artifact (`tooling_report.json`) plus human-readable summary.
3. Provide provider-specific configuration hints and remediation steps.
4. Fail closed in strict mode when core tooling prerequisites are absent.

---

## 2. Report artifact format

Write: `<buildRoot>/tooling_report.json`

```ts
export type ToolingReport = {
  generatedAt: string;
  repoRoot: string;
  buildRoot: string;

  identity: {
    chunkUid: {
      required: boolean;
      available: boolean;
      backend: 'native'|'wasm'|'none';
      notes?: string[];
    };
  };

  providers: Record<string, {
    id: string;
    version: string | null;
    enabled: boolean;

    capabilities: {
      supportsVirtualDocuments: boolean;
      supportsSegmentRouting: boolean;
      supportsJavaScript?: boolean;
      supportsTypeScript?: boolean;
      supportsSymbolRef?: boolean;
    };

    status: 'ok'|'warn'|'error';
    checks: { name: string; status: 'ok'|'warn'|'error'; message: string; details?: any }[];
  }>;

  summary: {
    status: 'ok'|'warn'|'error';
    warnings: number;
    errors: number;
  };
};
```

---

## 3. Identity prerequisite checks

### 3.1 chunkUid hashing backend

chunkUid (v1) relies on xxhash64.

Check:
- `src/shared/hash.js` can resolve backend:
  - native preferred
  - wasm acceptable
  - none is an error if chunkUid required

Report:
- backend type and any warnings (e.g., "native backend not available; using wasm (slower)").

Strict mode:
- if chunkUid required and backend is none → report error and fail build step that depends on tooling/graphs.

---

## 4. TypeScript provider checks

### 4.1 Presence and version

- Resolve `typescript` module import.
- Record `ts.version`.

Warn if:
- version is below minimum supported (define in provider; e.g., `<4.8`).

### 4.2 Configuration sanity

- If a `tsconfigPath` is configured:
  - ensure file exists
  - ensure JSON parses
- Validate compilerOptions relevant to parity:
  - allowJs
  - checkJs
  - jsx mode

### 4.3 VFS support

- Ensure provider is configured to accept virtual documents.
- If provider requires temp on-disk mapping, ensure temp dir is writable.

---

## 5. LSP provider checks

### 5.1 Server binary resolution

For each configured language server:
- ensure command exists on PATH or at configured absolute path

### 5.2 Initialization smoke test (optional but recommended)

If safe to run:
- start server
- send initialize
- shutdown/exit

Timeout fast (e.g., 2s). Record stderr on failure (truncated).

### 5.3 VFS routing capability

Report whether the server supports:
- file:// URIs pointing to temp-mapped VFS paths
- or custom URI schemes (if configured)

---

## 6. Human-readable summary output

Emit a short summary at the end of the indexing run, e.g.:

- overall: OK/WARN/ERROR
- key errors with remediation bullets
- path to `tooling_report.json`

---

## 7. Implementation plan

1. Create `src/index/tooling/doctor.js` exporting:
   - `runToolingDoctor(ctx, providerIds, options) -> ToolingReport`
2. Add identity checks (xxhash backend detection)
3. Add provider checks:
   - TypeScript provider check function
   - LSP provider check function
4. Write artifact and print summary
5. Integrate into CLI / runtime (where tooling is invoked)

---

## 8. Acceptance criteria

- [ ] `tooling_report.json` is emitted for runs that attempt tooling providers.
- [ ] Report includes identity.chunkUid backend status.
- [ ] Report includes provider capabilities (virtual docs, segment routing).
- [ ] Strict mode fails early on missing required tooling.

---

## 9. Tests (exact)

1. `tests/tooling/doctor-emits-report.test.js`
   - Assert artifact file exists and matches schema.

2. `tests/tooling/doctor-detects-missing-typescript.test.js`
   - Simulate missing typescript module; report error.

3. `tests/tooling/doctor-reports-xxhash-backend.test.js`
   - Force backend selection; report correct backend field.

