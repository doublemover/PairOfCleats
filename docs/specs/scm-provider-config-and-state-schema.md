# SCM Provider -- Configuration & Build-State Schema Spec (Phase 13)

This spec defines the configuration keys and artifact schema changes needed for a JJ-capable SCM provider system.

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
- `auto`: prefer JJ when `.jj/` exists and `jj` is runnable; else Git when `.git/` exists and Git runnable; else none.
- `git` or `jj`: strict; fail if tool is not available.

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

### Performance controls

```jsonc
{
  "indexing": {
    "scm": {
      - "maxConcurrentProcesses": 4,
      - "timeoutMs": 4000,
      - "churnWindowCommits": 10
    }
  }
}
```

Notes:
- `timeoutMs` applies to non-annotate SCM calls unless overridden.
- `churnWindowCommits` matches Git churn default.

## CLI flags (optional but recommended)

Add to `pairofcleats index build` and `pairofcleats index watch`:

- `--scm-provider <auto|git|jj|none>`
- `--scm-annotate` / `--no-scm-annotate`

These flags override config-file values.

## Build artifacts schema changes

### `index_state.json` (`src/index/build/build-state.js`)

Current: `repo: <git provenance object>`

New: `repo: <scm provenance object>`

Example:

```json
{
  "repo": {
    "provider": "jj",
    "workspaceRoot": "/abs/path",
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

For Git provider, populate:

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
- Keep existing `repo.commit` and `repo.branch` fields for Git where feasible, but add `provider` and normalize into `head.*`.

### `current.json` (promotion output)

Include `repo.provider` and `repo.head` similarly.

### Metrics artifact

Update `src/index/build/artifacts/metrics.js` to record:
- `repo.provider`
- `repo.head.commitId` (or Git SHA)
- `repo.dirty`

## Testing requirements

- Schema tests for build-state serialization/deserialization.
- Provider selection tests (auto chooses JJ when `.jj/` is present and `jj` runnable).
- Snapshot safety tests:
  - assert JJ commands include `--ignore-working-copy` by default.
  - when snapshotWorkingCopy enabled, assert exactly one snapshot command executes.

## Documentation requirements

- Document provider selection and what "auto" does.
- Document JJ read-only behavior and why it's necessary.
- Document annotate performance and defaults.
