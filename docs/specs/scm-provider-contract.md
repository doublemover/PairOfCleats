# SCM Provider Contract (Phase 13)

This spec defines the provider API surface, required return shapes, and selection rules for SCM providers.
It is the canonical contract for Git/JJ/none providers.

## 1) Provider interface

Each provider must implement these functions with the listed shapes.
All paths must be repo-relative and POSIX normalized.

### detect

```ts
function detect({ startPath }: { startPath: string }):
  | { ok: true; provider: 'git' | 'jj'; repoRoot: string; detectedBy?: string }
  | { ok: false };
```

Rules:
- `repoRoot` is an absolute path.
- `detectedBy` describes the detection path (e.g., `git-root`, `jj-root`).

### listTrackedFiles

```ts
function listTrackedFiles({ repoRoot, subdir }:
  { repoRoot: string; subdir?: string | null }):
  { filesPosix: string[] } | { ok: false; reason: 'unavailable' };
```

Rules:
- `filesPosix` are repo-relative, POSIX separators, sorted ascending.
- `subdir` filters to a repo-relative folder (provider may ignore if unsupported).
- On provider errors (missing tool, repo unreadable), return `{ ok:false, reason:'unavailable' }` so callers can fall back.

### getRepoProvenance

```ts
function getRepoProvenance({ repoRoot }:
  { repoRoot: string }):
  {
    provider: 'git' | 'jj' | 'none';
    root: string;
    head: {
      commitId?: string | null;
      changeId?: string | null;
      operationId?: string | null;
      branch?: string | null;
      bookmarks?: string[] | null;
      author?: string | null;
      timestamp?: string | null;
    } | null;
    dirty: boolean | null;
    detectedBy?: string | null;
  };
```

Rules:
- `provider=none` uses `head=null`, `dirty=null`, and omits provider-specific fields.
- `root` is absolute; `head` fields are optional and best-effort.

### getChangedFiles

```ts
function getChangedFiles({ repoRoot, fromRef, toRef, subdir }:
  { repoRoot: string; fromRef?: string | null; toRef?: string | null; subdir?: string | null }):
  { filesPosix: string[] } | { ok: false; reason: 'unsupported' | 'unavailable' };
```

Rules:
- If unsupported, return `{ ok:false, reason:'unsupported' }` (do not throw).

### getFileMeta

```ts
function getFileMeta({ repoRoot, filePosix }:
  { repoRoot: string; filePosix: string }):
  {
    lastModifiedAt?: string | null;
    lastAuthor?: string | null;
    churn?: number | null;
    churnAdded?: number | null;
    churnDeleted?: number | null;
    churnCommits?: number | null;
  } | { ok: false; reason: 'unsupported' | 'unavailable' };
```

### annotate (optional)

```ts
function annotate({ repoRoot, filePosix, timeoutMs }:
  { repoRoot: string; filePosix: string; timeoutMs: number }):
  { lines: Array<{ line: number; author: string; commitId?: string | null }> }
  | { ok: false; reason: 'disabled' | 'unsupported' | 'timeout' };
```

Rules:
- Providers must enforce `indexing.scm.annotate` caps and timeouts.
- `line` is 1-based.

## 2) Path normalization

All providers must normalize paths the same way:

- Repo-relative, POSIX separators (`/`).
- No leading `./`.
- No `..` segments.
- Preserve leading/trailing spaces in filenames; do not trim entries (drop only empty entries).

Use a shared helper: `toRepoPosixPath(filePath, repoRoot)`.

## 3) Provider selection (decision table)

Selection input:
- `indexing.scm.provider` (`auto|git|jj|none`)
- detected repo markers: `.git/`, `.jj/`
- tool availability

Decision table:

| provider setting | .git/ | .jj/ | tool avail | result |
| --- | --- | --- | --- | --- |
| git | any | any | git ok | git |
| git | any | any | git missing | error |
| jj | any | any | jj ok | jj |
| jj | any | any | jj missing | error |
| none | any | any | any | none |
| auto | yes | no | git ok | git |
| auto | no | yes | jj ok | jj |
| auto | yes | yes | any | **error** (explicit provider required) |
| auto | no | no | any | none |

## 4) BuildId and signature provenance rules

- `buildId` format: `YYYYMMDDTHHMMSSZ_<scmHeadShort>_<configHash8>`
- `scmHeadShort` rules:
  - git: short commit SHA
  - jj: changeId (preferred) else commitId
  - none: `noscm`

Build signatures and build_state MUST record `repo.provider` and `repo.head`.

## 5) Capability / skip semantics

When a provider cannot perform an operation:

- Return `{ ok:false, reason:'unsupported' }` for unsupported methods.
- Return `{ ok:false, reason:'unavailable' }` for temporary failures (missing binary, repo unreadable).
- Emit a single warning per run for missing provider binaries (avoid log spam).

## 6) Determinism and ordering

- All file lists are sorted ascending before return.
- All SCM-derived metadata must be stable for the same repo state.
- Providers must not include local-only paths or machine-specific values in outputs.

## 7) Runtime contract enforcement

`src/index/scm/provider.js` is the runtime enforcement layer for this contract.

- Providers are wrapped by `assertScmProvider(...)`.
- Returned file lists are normalized to repo-relative POSIX paths and sorted deterministically.
- Throwing provider methods are normalized to deterministic unavailable payloads:
  - `{ ok:false, reason:'unavailable' }` for operational failures.
- Provenance payloads are normalized to a stable shape so downstream build-state serialization is strict.
