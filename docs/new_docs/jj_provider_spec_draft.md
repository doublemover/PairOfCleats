# Draft: JJ Provider Spec (Comprehensive) — Commands, Pinning, Parsing, and Safety

This document is the standalone “JJ provider” draft for Phase 13. It expands the existing reference material and is intended to be sufficiently detailed to implement without mid-phase rescoping.

---

## 0) Goals

- Provide a JJ-backed implementation of the `ScmProvider` interface.
- Default to **read-only** behavior (do not snapshot/mutate the working copy unless explicitly enabled).
- Make parsing deterministic and robust (JSONL where possible; strict trimming rules elsewhere).
- Support:
  - repo root detection
  - tracked file enumeration
  - repo provenance (head-ish identity)
  - dirty status (best-effort)
  - changed files between refs
  - optional per-file churn metadata
  - optional annotate (off by default; bounded)

---

## 1) Global subprocess requirements

All JJ subprocess calls MUST:

- be executed with an argument array (no shell)
- include:
  - `--no-pager`
  - `--color=never`
  - `--quiet` (unless you need stderr diagnostics)
- be bounded by:
  - timeout (`indexing.scm.timeoutMs`, annotate has its own)
  - concurrency semaphore (`indexing.scm.maxConcurrentProcesses`)
- log a single, non-spammy diagnostic line per run:
  - provider chosen (`jj`)
  - JJ version (if available)
  - whether read-only pinning is active
  - workspace root

### 1.1 Read-only pinning (default)
By default (when `indexing.scm.jj.snapshotWorkingCopy=false`), all JJ commands MUST include:

- `--at-operation=@`
- `--ignore-working-copy`

Rationale:
- JJ snapshots the working copy by default; we must avoid hidden mutations and cost.

### 1.2 Optional “snapshotWorkingCopy” mode
If `snapshotWorkingCopy=true`, PairOfCleats may:
- perform exactly one explicit snapshot operation at start (bounded timeout)
- record the resulting operation ID
- pin subsequent commands to that operation ID (not to `@`)

This mode must:
- be explicitly opt-in,
- be safe by default (no auto-tracking new files unless explicitly intended),
- and be test-covered.

---

## 2) Fileset escaping spec (required)

Many JJ commands accept FILESET expressions. A raw path may contain whitespace or metacharacters.

### 2.1 Required helper
`toJjFileset(relPathPosix: string): string`

Rules:
- Input is a repo-relative POSIX path (no leading `/`).
- Output matches *exactly* that file.
- Reject:
  - NUL bytes
  - path segments that escape root (`..`)
- Recommended output format:
  - `root-file:"<escaped>"`

Escaping rules inside the quoted string:
- `\` for backslash
- `\"` for double quote
- preserve `/` as separator

Examples:
- `src/foo bar.js` → `root-file:"src/foo bar.js"`
- `weird"quote.txt` → `root-file:"weird\"quote.txt"`

---

## 3) Command inventory (normative)

### 3.1 Determine workspace root
**Invocation:**
- `jj root`

**Parsing:**
- trim stdout
- if empty: error (`INTERNAL`, message “jj root returned empty”)
- normalize to absolute path (resolve relative output against cwd, though JJ should output absolute)

### 3.2 Check capability / version
**Invocation:**
- `jj --version`

**Parsing:**
- best-effort capture version string
- absence/failure: treat as capability missing only if JJ is otherwise not runnable

### 3.3 List tracked files at revision `@`
**Invocation:**
- `jj file list -r @`

Plus global args and pinning.

**Parsing:**
- split by `\n`
- trim each line; drop empties
- normalize separators (`\` → `/` if present)
- return sorted unique list (byte-wise)

Notes:
- apply ignore matcher after listing
- treat output as repo-relative

### 3.4 Repo provenance (head-ish identity)
**Purpose:** record a stable identity for the revision being indexed.

**Invocation:**
- `jj log --no-graph -n 1 -r @ -T <TEMPLATE>`

**Template requirements:**
- output exactly 1 JSON object (JSONL)
- recommended template:

```text
json({
  "commit_id": commit_id,
  "change_id": change_id,
  "author": author.name(),
  "timestamp": author.timestamp().utc().format("%Y-%m-%dT%H:%M:%SZ")
})
```

**Parsing:**
- parse JSON
- if parse fails: return reduced provenance `{}` but do not crash the build

**Output mapping to build_state.json:**
```jsonc
{
  "provider": "jj",
  "head": {
    "commitId": "<commit_id>",
    "changeId": "<change_id>"
  }
}
```

Optional:
- `bookmarks` list (if cheap to query reliably)

### 3.5 Dirty status (best-effort)
**Invocation:**
- `jj diff -r @ --name-only`

**Parsing:**
- if any non-empty line: `dirty=true`
- if none: `dirty=false`
- if command fails: `dirty=null` and emit warning once

### 3.6 Changed files between two revs (incremental hook)
**Invocation:**
- `jj diff --from <REV_A> --to <REV_B> --name-only`

**Parsing:**
- one repo-relative path per line
- normalize separators
- apply ignore matcher
- stable sort unique

### 3.7 Per-file churn + last-modified (optional; bounded)
**Purpose:** populate `ScmFileMeta` for “interesting” files or for a capped subset.

**Invocation:**
- `jj log --no-graph -n <N> -T <TEMPLATE> <FILESET>`

**Template design constraints:**
- output JSONL objects (one per revision)
- must include author + timestamp
- must include added/removed restricted to the fileset

Recommended approach:
- generate a template that embeds the fileset expression as a *string literal* (not raw)
- use `self.diff(filesetLiteral).stat().total_added()` and `.total_removed()`

**Parsing:**
- parse up to N JSON objects
- first object is “most recent touch”:
  - `lastAuthor`
  - `lastModifiedAt`
- churn is sum of added+removed and count of commits

**Guards:**
- skip entirely unless explicitly enabled
- never run for files > a size threshold unless you have a very good reason

### 3.8 Annotate / blame (optional; gated; bounded)
**Invocation:**
- `jj file annotate -T <TEMPLATE> <FILESET>`

**Template:**
- output exactly one author identity per line
- recommended:
  - `commit.author().name()`

**Parsing:**
- split by newline
- each output line corresponds to a file line (1:1)

**Guards:**
- file size cap
- timeout cap
- feature flag (`indexing.scm.annotate.enabled`)

---

## 4) Provider selection + fallback rules

- Detection:
  - `.jj/` presence is a strong signal
  - but still require `jj` runnable (capability check)
- In `auto` mode:
  - prefer JJ over Git only when JJ is present and runnable
- If JJ exists but commands fail unexpectedly:
  - surface a clear “JJ provider failure” error
  - optionally allow fallback to `none` only when explicitly configured (do not silently switch providers mid-build)

---

## 5) Failure modes and how to handle them

### 5.1 Template parsing drift
JJ template output can change across versions.
Mitigations:
- prefer JSON output via `json(...)` template
- keep parser strict but degrade to “reduced provenance” rather than failing the whole build (except in strict modes)

### 5.2 Fileset injection hazards
Never build a template by concatenating raw paths into template code.
Always:
- escape the fileset expression into a string literal
- validate inputs (no NUL; no `..` escape)

### 5.3 Working copy mutation
Default mode must include `--ignore-working-copy` and operation pinning.
If snapshotWorkingCopy is enabled:
- do exactly one controlled snapshot
- record and pin to that op
- keep it observable in logs + build_state

---

## 6) Test plan

### Unit
- `toJjFileset()` escaping tests (whitespace, quotes, backslashes, reject NUL)
- parsing tests for:
  - `jj file list`
  - `jj log` JSONL
  - `jj diff --name-only`

### Service
- Prefer fixture-based tests (captured command output) so CI does not require jj.
- If jj is present, run an optional integration suite.

### Skip semantics
If jj is not installed:
- tests should return exit code 77 (skipped) using the existing harness.

---

## 7) Open questions

1. Do we need bookmarks in provenance for v1, or can we defer?
2. Should we record JJ operation IDs in build_state for stronger pinning?
3. What is the best “dirty” definition for JJ (working copy vs parent diff)?
4. For churn: do we want to restrict to only “top N touched files” to avoid cost?

