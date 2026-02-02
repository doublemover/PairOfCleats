# SCM Provider -- Configuration & Build-State Schema Spec (Phase 13)

This spec defines configuration keys and build_state schema changes for the SCM provider system.
The provider API contract is defined in `docs/specs/scm-provider-contract.md`.

## Configuration keys

All keys live under `indexing.scm` unless stated otherwise.

### Provider selection

```jsonc
{
  "indexing": {
    "scm": {
      "provider": "auto" // auto | git | jj | none
    }
  }
}
```

Rules:
- `auto`: detect SCM type by repo markers.
  - If both `.git/` and `.jj/` exist and no explicit provider was set, **hard fail** and prompt.
  - If only `.git/` exists and git is runnable, use git.
  - If only `.jj/` exists and jj is runnable, use jj.
  - If no SCM markers or tool is missing, fall back to `none`.
- `git` or `jj`: strict; fail if tool is not available or repo root is unreadable.
- `none`: explicit filesystem-only mode (no SCM provenance).

### JJ safety defaults

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

- `snapshotWorkingCopy=false` means all JJ commands run with `--ignore-working-copy` and `--at-op=@`.
- If enabled, PairOfCleats performs exactly one controlled snapshot at start with `snapshot.auto-track='none()'`, then pins subsequent commands to that operation.

### Annotate controls

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

Legacy mapping:
- `indexing.gitBlame` and `analysisPolicy.git.blame` map to `indexing.scm.annotate.enabled` (deprecated).

### Performance controls

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

Notes:
- `timeoutMs` applies to non-annotate SCM calls unless overridden.
- `churnWindowCommits` matches the Git churn default.

## CLI flags (optional but recommended)

Add to `pairofcleats index build` and `pairofcleats index watch`:

- `--scm-provider <auto|git|jj|none>`
- `--scm-annotate` / `--no-scm-annotate`

These flags override config-file values.

## Build-state schema changes

`build_state.json` is the canonical build provenance file. The schema is defined in:

- `src/contracts/schemas/build-state.js`
- `src/contracts/validators/build-state.js`

### Required provenance fields

- `repo.provider` (`git|jj|none`)
- `repo.root` (absolute repo root)
- `repo.head` (provider-specific head fields)
- `repo.dirty` (best-effort dirty status)

When `provider=none`, `repo.head` and other SCM fields are `null`.

### Example (JJ)

```json
{
  "repo": {
    "provider": "jj",
    "root": "/abs/path",
    "head": {
      "commitId": "kqrx...",
      "changeId": "qpvu..."
    },
    "bookmarks": ["main"],
    "dirty": true,
    "detectedBy": "jj-root"
  }
}
```

### Example (Git)

```json
{
  "repo": {
    "provider": "git",
    "root": "/abs/path",
    "head": {
      "commitId": "abc123...",
      "branch": "main"
    },
    "dirty": false
  }
}
```

Back-compat rule:
- Keep existing `repo.commit` and `repo.branch` fields for Git where feasible, but treat `repo.provider` and `repo.head.*` as authoritative.

### Migration checklist (legacy repo fields)
- Keep writing `repo.commit` and `repo.branch` for Git during Phase 13 for back-compat.
- Keep `repo.isRepo` until downstream consumers stop reading it.
- Update all readers to prefer `repo.provider` + `repo.head.*`.
- Remove legacy fields once all downstream consumers migrate (target: next major schema bump).

## BuildId rules

`buildId` is derived from SCM provenance and config:

- format: `YYYYMMDDTHHMMSSZ_<scmHeadShort>_<configHash8>`
- `scmHeadShort` is derived from provider head:
  - git: short commit SHA
  - jj: changeId when available, else commitId
  - none: `noscm`

## Testing requirements

- Schema tests for build-state serialization/deserialization.
- Provider selection tests (auto chooses JJ when `.jj/` is present and `jj` runnable).
- Snapshot safety tests:
  - assert JJ commands include `--ignore-working-copy` by default.
  - when `snapshotWorkingCopy` enabled, assert exactly one snapshot command executes.

## Documentation requirements

- Document provider selection and what `auto` does.
- Document JJ read-only behavior and why it's necessary.
- Document annotate performance and defaults.
