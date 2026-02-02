# JJ Provider -- CLI Commands, Templates, and Parsing Spec

This document specifies the exact `jj` CLI invocations and output parsing rules for the JJ SCM provider.

## Global invocation requirements

All JJ subprocess calls MUST:

- execute via `spawn`/`execa` with an argument array (no shell)
- include:
  - `--no-pager`
  - `--color=never`
  - `--quiet`
- include **read-only pinning** by default:
  - `--at-operation=@ --ignore-working-copy`

Rationale:
- `jj` snapshots the working copy by default; we must avoid mutation and excessive operations.

## Fileset escaping

Many commands accept FILESET expressions. A raw path may contain whitespace or metacharacters.

### Required function

`toJjFileset(relPath: string): string`

Rules:

- Input is a repo-relative path (POSIX separators).
- Output must be a valid fileset expression matching exactly the file.

Recommended format:

- `root-file:"<escaped>"`

Escaping rules inside the double-quoted string:

- `\` for backslash
- `"` for double quote
- Preserve `/` as separator
- Reject NUL

Example:

- `src/foo bar.js` → `root-file:"src/foo bar.js"`
- `weird"quote.txt` → `root-file:"weird\"quote.txt"`

## Command specs

### 1) Workspace root

**Purpose:** determine JJ workspace root path.

Invocation:

- `jj root`

Parsing:

- Trim stdout.
- If empty → error.
- If path is relative, resolve against `cwd` (should not happen in normal JJ output).

### 2) Tracked files

**Purpose:** list tracked files in `@`.

Invocation (preferred):

- `jj file list --tracked -0 -r @`

Fallback (if `-0` is unavailable):

- `jj file list -r @`

Parsing:

- Prefer NUL splitting (`-0`) when available; otherwise split by newline.
- Trim each line; drop empties.
- Treat each line as repo-relative path (normalize `\` → `/` if seen).
- Apply ignore matcher and any user filters.
- Sort deterministically (byte-wise ASCII/path order).

Notes:
- `jj file list` outputs tracked files at the requested revision.

### 3) Repo provenance (head-ish identity)

**Purpose:** get commit id, change id, author, timestamp, and bookmarks (if feasible).

Invocation shape:

- `jj log --no-graph -n 1 -r @ -T <TEMPLATE>`

Template requirements:

- output a single JSON object per revision (JSONL)

Recommended template:

- `json({ "commit_id": commit_id.short(12), "change_id": change_id.short(12), "author": author.name(), "timestamp": author.timestamp().utc().format("%Y-%m-%dT%H:%M:%SZ") })`

Parsing:

- Parse JSON per line.
- If parse fails, treat as unavailable and continue with reduced provenance fields.

### 4) Dirty status

**Purpose:** determine whether working-copy commit differs from its parent(s).

Invocation:

- `jj diff -r @ --name-only`

Parsing:

- If stdout contains ≥ 1 non-empty line → `dirty=true`
- If stdout empty → `dirty=false`
- If command fails → `dirty=null` and log warning.

### 5) Per-file history metadata + churn

**Purpose:** populate `last_modified`, `last_author`, churn metrics.

Invocation shape:

- `jj log --no-graph -n <N> -T <TEMPLATE> <FILESET>`

Template:

Must emit JSONL with:
- author name
- timestamp (UTC ISO string)
- `added` and `removed` restricted to the file

Recommended template generator:

Given `filesetLiteral` (a *string literal* containing the fileset expression), use:

- `json({ "author": author.name(), "timestamp": author.timestamp().utc().format("%Y-%m-%dT%H:%M:%SZ"), "added": self.diff(filesetLiteral).stat().total_added(), "removed": self.diff(filesetLiteral).stat().total_removed() })`

Important:
- `filesetLiteral` must be a quoted string literal in the template. The provider must inject it safely.

Parsing + aggregation:

- Read up to N JSON lines.
- The first line corresponds to the most recent revision touching the file:
  - `last_author = author`
  - `last_modified = timestamp`
- Accumulate:
  - `churn_added = Σ added`
  - `churn_deleted = Σ removed`
  - `churn_commits = count(lines)`
  - `churn = churn_added + churn_deleted`

Error handling:
- Missing stats → treat `added/removed` as 0 for that entry.

### 6) Annotate / blame (optional)

**Purpose:** produce `lineAuthors[]` aligned with file content line order.

Invocation:

- `jj file annotate -T <TEMPLATE> <FILESET>`

Template:

- Must output exactly one author name per line (no extra prefixes).
- Recommended:
  - `commit.author().name()`

Parsing:

- Split by newline.
- Resulting array index corresponds to 1-based line number - 1.

Guards:
- Skip if file size > `indexing.scm.annotate.maxFileSizeBytes`
- Timeout enforced

### 7) Changed files (incremental hook)

**Purpose:** list changed files between two revs.

Invocation:

- `jj diff --from <REV_A> --to <REV_B> --name-only`

Parsing:

- One repo-relative path per line.
- Apply ignore matcher.
- Sort deterministically and truncate to a fixed cap to avoid unbounded outputs.
  - Default cap: 10,000 entries.

## Performance constraints

- All JJ subprocess calls must be limited by a provider-level concurrency semaphore:
  - `indexing.scm.maxConcurrentProcesses` (default: 2-4)
- Apply timeouts:
  - provenance, file list, per-file meta: default 2-5 seconds
  - annotate: default 10 seconds (and only when enabled)

## Diagnostics

Log once per run:

- provider chosen
- workspace root
- `jj --version` (if available) for debugging
- whether read-only pinning is active (`--ignore-working-copy`, `--at-op`)
