# SPEC -- Phase 14: Config Defaults for Snapshots, Diffs, and Retention (Draft)

> **Scope**: Optional (but recommended) configuration keys that provide repo-level defaults for:
> - snapshot retention and pruning
> - diff retention and pruning
> - diff compute bounds and feature toggles
>
> **Why this doc exists**: The Phase 14 core specs are CLI-first and define defaults in flags.
> In practice, operators often want stable repo-local defaults without always passing long CLI flags.
>
> **Compatibility**: All keys in this document are optional. If omitted, the CLI defaults in the Phase 14 specs apply.

---

## 0. Design rules

1. **CLI overrides config**  
   If a flag is provided on the command line, it MUST take precedence over config defaults.

2. **Config overrides built-in defaults**  
   If config sets a value, it becomes the default when the user does *not* pass an explicit flag.

3. **No new behavior without explicit config**  
   Adding config keys must not change behavior for repos that do not set them.

4. **Safety: protected tags**  
   Retention MUST never delete snapshots protected by configured tag globs (default: `release/*`).

---

## 1. Proposed config keys

All keys are under `indexing` (consistent with existing config grouping).

### 1.1 Snapshots retention defaults

```jsonc
{
  "indexing": {
    "snapshots": {
      "keepPointer": 50,
      "keepFrozen": 20,
      "maxAgeDays": 30,
      "protectedTagGlobs": ["release/*"],
      "stagingMaxAgeHours": 24
    }
  }
}
```

Semantics:
- `keepPointer` → default for `index snapshot prune --keep-pointer`
- `keepFrozen` → default for `index snapshot prune --keep-frozen`
- `maxAgeDays` → default for `index snapshot prune --max-age-days` (nullable to disable age pruning)
- `protectedTagGlobs` → default for `index snapshot prune --keep-tags`
  - Glob matching rules must be documented and deterministic (recommend: minimatch)
- `stagingMaxAgeHours` → used by staging cleanup (spec §7)

### 1.2 Diffs retention defaults

```jsonc
{
  "indexing": {
    "diffs": {
      "keep": 100,
      "maxAgeDays": 30
    }
  }
}
```

Semantics:
- `keep` → default for `index diff prune --keep` (this flag should be added if not present yet)
- `maxAgeDays` → default for `index diff prune --max-age-days` (nullable to disable)

> If you want diffs to be protected by tags, add a `protectedTagGlobs` and a tag field in the diff registry.
> This is optional; Phase 14 can ship without diff tagging if desired.

### 1.3 Diff compute defaults

```jsonc
{
  "indexing": {
    "diffs": {
      "compute": {
        "modes": ["code"],
        "maxChangedFiles": 200,
        "maxChunksPerFile": 500,
        "maxEvents": 20000,
        "detectRenames": true,
        "includeRelations": true,
        "persist": true
      }
    }
  }
}
```

Semantics:
- These keys provide defaults for `index diff compute` options when flags are omitted.
- `persist` is ignored for `path:` refs unless `--persist-unsafe` is explicitly provided.

---

## 2. Schema + normalization requirements

If these keys are implemented, they MUST be:

1. Added to `docs/config/schema.json` under `properties.indexing.properties`:
   - `snapshots` object with the keys above
   - `diffs` object with the keys above

2. Passed through normalization in `tools/dict-utils/config.js#normalizeUserConfig`:
   - Preserve only expected keys
   - Drop unknown keys to keep config stable and validated

3. Covered by tests:
   - schema validation accepts the new keys
   - normalization preserves them and trims strings if applicable

---

## 3. CLI precedence rules

When reading defaults for pruning and diff compute:

1. Start with the CLI spec defaults (from Phase 14 specs)
2. Override with config values (if present)
3. Override with explicit CLI flags (if present)

This preserves backwards compatibility.

---

## 4. Recommendations / future refinements (optional)

- Add `indexing.diffs.protectedTagGlobs` once diff tagging exists.
- Add a global `indexing.retention.enabled` boolean if you ever implement automatic background pruning (out of Phase 14).
