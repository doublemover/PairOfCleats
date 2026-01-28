# Draft: Reworked Phase 13 — SCM Provider Abstraction + Git Migration + JJ Provider

This document is a standalone draft of the fully reworked Phase 13 plan, including a **full SCM provider interface spec**.

> Key re-scope: Phase 13 must be implemented as two steps:  
> (1) introduce an SCM provider abstraction + migrate Git onto it, then  
> (2) implement JJ provider.

---

## 0) Goals and non-goals

### Goals
- Support indexing and incremental workflows against:
  - Git repos (default)
  - JJ repos
  - “no SCM” directories (filesystem-only)
- Provide a single, coherent place to reason about:
  - tracked file discovery
  - repo provenance recorded into build artifacts
  - “changed files” queries for reuse
  - optional annotate/blame + churn metadata
- Make provider choice explicit, observable, and testable.
- Ensure determinism: stable sorting and normalized paths.

### Non-goals (Phase 13)
- Implementing a full “watch mode” for JJ parity with Git hooks (can be later).
- Performing any destructive JJ operations by default.
- Adding new storage backends.

---

## 1) Public configuration contract

All keys live under `indexing.scm` unless stated.

### 1.1 Provider selection
```jsonc
{
  "indexing": {
    "scm": {
      "provider": "auto" // auto | git | jj | none
    }
  }
}
```

Rules (recommended):
- `auto`:
  - prefer JJ when `.jj/` exists **and** `jj` is runnable
  - else prefer Git when `.git/` exists **and** `git` is runnable
  - else fall back to `none`
- `git` or `jj`: strict; fail if tool is not available.
- `none`: filesystem-only discovery; provenance fields explicitly null.

### 1.2 Performance controls
```jsonc
{
  "indexing": {
    "scm": {
      "maxConcurrentProcesses": 4,
      "timeoutMs": 4000,
      "churnWindowCommits": 10
    }
  }
}
```

### 1.3 Annotate controls (optional; off by default)
```jsonc
{
  "indexing": {
    "scm": {
      "annotate": {
        "enabled": false,
        "maxFileSizeBytes": 262144,
        "timeoutMs": 10000
      }
    }
  }
}
```

### 1.4 JJ safety defaults (read-only pinning)
```jsonc
{
  "indexing": {
    "scm": {
      "jj": {
        "snapshotWorkingCopy": false
      }
    }
  }
}
```

- If `snapshotWorkingCopy=false`, all JJ commands must run with read-only pinning:
  - `--ignore-working-copy`
  - `--at-operation=@` (or equivalent)
- If enabled, PairOfCleats performs exactly one controlled snapshot at start, then pins subsequent commands to that operation.

### 1.5 CLI flags (recommended)
- `--scm-provider <auto|git|jj|none>`
- `--scm-annotate` / `--no-scm-annotate`

---

## 2) Build artifact changes (state contract)

### 2.1 `build_state.json` / `index_state.json` repo provenance
Store normalized provenance in a stable shape:

```jsonc
{
  "repo": {
    "provider": "git|jj|none",
    "root": "/abs/path/to/repo/root",
    "head": {
      // Provider-specific but stable keys:
      "commitId": "abc123…",     // git sha or jj commit id
      "changeId": "qpvu…",       // jj only (optional)
      "branch": "main",          // git only (optional)
      "bookmarks": ["main"]      // jj only (optional)
    },
    "dirty": false,
    "detectedBy": "auto|git-root|jj-root|none"
  }
}
```

Rules:
- `provider` is required.
- For `none`, `root` is still the chosen workspace root, but `head` is `{}` and `dirty` is `null` or `false` (be explicit).
- Back-compat: keep legacy Git fields (`repo.commit`, `repo.branch`) if already emitted, but treat `repo.provider` + `repo.head.*` as authoritative.

---

## 3) SCM provider interface spec (normative)

### 3.1 Module layout (recommended)
- `src/index/scm/types.js` — shared JSDoc typedefs
- `src/index/scm/provider.js` — interface contract + shared helpers
- `src/index/scm/registry.js` — provider selection + capability gating
- `src/index/scm/providers/git.js`
- `src/index/scm/providers/jj.js`
- `src/index/scm/providers/none.js`

### 3.2 Path normalization requirements
All providers MUST:
- return **repo-relative** paths using **POSIX separators** (`/`)
- ensure no `..` segments (normalize and reject if escapes root)
- stable-sort returned file lists using byte-wise ASCII/path order

### 3.3 Core types

#### `ScmDetectResult`
```ts
type ScmDetectResult =
  | { ok: true; provider: 'git'|'jj'|'none'; repoRoot: string; detectedBy: string }
  | { ok: false; reason?: string };
```

#### `RepoProvenance`
```ts
type RepoProvenance = {
  provider: 'git'|'jj'|'none';
  root: string;
  head: Record<string, any>;   // stable keys per provider (documented below)
  dirty: boolean | null;
  detectedBy?: string;
};
```

#### `ScmFileMeta` (best-effort)
```ts
type ScmFileMeta = {
  lastCommitId?: string;
  lastAuthor?: string;
  lastModifiedAt?: string;     // ISO UTC
  churnAdded?: number;
  churnDeleted?: number;
  churnCommits?: number;
};
```

### 3.4 Provider methods (required unless stated)

#### `detect({ startPath })`
- Input: absolute path
- Output: `ScmDetectResult`
- Must not throw for “not a repo”; return `{ ok:false }`.

#### `listTrackedFiles({ repoRoot, subdir? })`
- Output: `{ filesPosix: string[] }`
- For `none`, this becomes “discover files by filesystem rules” (existing fdir behavior).

#### `getRepoProvenance({ repoRoot })`
- Output: `RepoProvenance`
- For `none`, returns `provider:'none'`, `head:{}`, `dirty:null`.

#### `getChangedFiles({ repoRoot, fromRef, toRef, subdir? })`
- Output: `{ filesPosix: string[] }`
- For `none`, return a structured “not supported” error unless the caller provides an explicit list elsewhere.

#### `getFileMeta({ repoRoot, filePosix })` (optional but recommended)
- Output: `ScmFileMeta`
- May be disabled via config; must be bounded by timeouts and size limits.

#### `annotate({ repoRoot, filePosix, timeoutMs })` (optional)
- Output:
```ts
{ lines: Array<{ line: number; author?: string; commitId?: string }> }
```
- Must be gated behind `indexing.scm.annotate.enabled`.

### 3.5 Error handling contract
Providers should not throw raw errors unless they indicate programmer bugs. For runtime failures:
- return structured errors using `createError(code, message, details)`
- recommended codes:
  - `CAPABILITY_MISSING` (binary absent)
  - `INVALID_REQUEST` (bad args)
  - `INTERNAL` (unexpected)
  - provider-specific parse errors should still map to `INTERNAL` but include `details.provider='jj'`

### 3.6 Concurrency + timeouts
All SCM subprocess calls MUST:
- use arg arrays (no shell)
- be bounded by timeouts
- be bounded by a provider-level concurrency semaphore
- log once-per-run diagnostics: provider chosen, tool version (if feasible), and whether read-only pinning is active.

---

## 4) Implementation plan (reworked Phase 13)

### 4.1 Step 1 — Introduce interface + migrate Git (mandatory first)
- Create the registry + interface
- Implement `none` provider using existing filesystem discovery
- Implement `git` provider by moving existing logic out of:
  - `src/index/git.js`
  - `src/index/build/discover.js`
- Replace direct git shelling calls outside provider modules with provider calls

### 4.2 Step 2 — Implement JJ provider
- Detection (`.jj/`, `jj root`, `jj --version`)
- Tracked files (`jj file list -r @`)
- Provenance (`jj log -n 1 -r @ -T json(...)`)
- Dirty status (`jj diff -r @ --name-only`)
- Changed files (`jj diff --from A --to B --name-only`)
- Optional per-file churn (`jj log … self.diff(fileset).stat() …`)
- Optional annotate (`jj file annotate …`) gated off by default

---

## 5) “Non-code environment” usability (explicitly supported)

Even without a Git/JJ repo, users should be able to:
- index a directory (`scm.provider=none`)
- still get stable file discovery, stable paths, and deterministic ordering
- optionally supply an explicit change list for reuse flows:
  - `pairofcleats index build --changed-list <path>` (future-friendly)
  - or a `records`/workspace-level manifest that enumerates changed files

Key principle: when provenance is unavailable, the system must say so explicitly (nulls), not invent fake commit IDs.

---

## 6) Testing plan

### Unit tests
- provider selection: `auto` chooses jj/git/none deterministically (capability-gated)
- path normalization: separators and sorting
- build_state serialization includes `repo.provider` + normalized `repo.head`

### Service tests
- Git provider:
  - build inside a git fixture and assert discovery uses tracked files
- JJ provider:
  - tests should skip cleanly when `jj` is unavailable
  - parsing tests use captured fixture outputs (no need to run jj in CI unless available)

---

## 7) Open questions (for finalization)

1. Do we want `repo.head.commitId` to be “short” or full? (Recommendation: full; UI can shorten.)
2. For JJ, do we also want to record `operationId` (since “@” can be reinterpreted)?
3. Do we need `getChangedFiles` for watch-mode in Phase 13, or can it be deferred?
4. How much churn/meta do we actually want to spend time on by default? (cost vs value)

