# Spec: Large-file Cap Strategy and Resolution Contract

Status: Active v2.1  
Last updated: 2026-02-20T23:10:00Z

## Goals

1. Keep indexing bounded on large inputs.
2. Ensure cap enforcement is deterministic and user-visible.
3. Resolve caps using extension, language, and mode hints where applicable.
4. Keep skip/reuse behavior consistent across discover, watch, pre-read, cached reuse, and CPU stages.
5. Keep language-aware cap defaults deterministic and reproducible via calibration artifacts.

## Non-goals

- No truncation/index-partial semantics in this contract.
- No dual legacy cap-resolution paths.

## Canonical resolver

`resolveFileCaps(fileCaps, ext, languageId = null, mode = null) -> { maxBytes, maxLines }`

Semantics:

1. Start from `fileCaps.byMode[mode]` when provided; otherwise `fileCaps.default`.
2. Apply `fileCaps.byExt[ext]` and `fileCaps.byLanguage[languageId]`.
3. For each dimension (`maxBytes`, `maxLines`), use strictest (`min`) among applicable limits.
4. Apply runtime guardrail clamps from `runtime/caps.js`.

## Language-aware calibration artifacts

Language-aware defaults are derived from calibration artifacts and committed in-repo.

- Inputs: `docs/config/caps-calibration-inputs.json`
- Results: `docs/config/caps-calibration-results.json`
- Runtime baseline source: `src/index/build/runtime/caps-calibration.js`
- Regeneration command: `npm run caps:calibrate`

These artifacts are deterministic and versioned; cap updates must update both files in the same change.

## Active stage behavior

### Discover

- Uses extension + language-aware cap lookup.
- Applies effective max bytes based on runtime `maxFileBytes` and resolved file caps.
- Discovery is mode-agnostic for pre-read decisions.

### Watch

- Uses extension + language-aware cap lookup.
- Applies effective max bytes (`min(runtime.maxFileBytes, caps.maxBytes)`).

### Pre-read skip

- Uses extension + language + mode-aware cap lookup.
- Uses effective max bytes and max lines for deterministic skip decisions.

### Cached bundle reuse

- Re-validates entry against extension + language + mode caps before reuse.
- Never rehydrates cached rows that violate active caps.

### CPU processing

- Uses resolved caps and parser limits to enforce final bounded behavior.

## Oversize skip contract

When a file is skipped due to size/line caps, emit deterministic metadata with:

- `reason: "oversize"`
- `stage`: one of `discover`, `watch`, `pre-read`, `cached-reuse`, `cpu`
- `bytes`, `maxBytes` when byte cap triggers
- `lines`, `maxLines` when line cap triggers
- `languageId` when known

## Guardrails

- `maxFileBytes` is a hard upper clamp.
- Untrusted/runtime guardrails may tighten configured caps.
- More specific caps can only make limits stricter.

## Required tests

- Language-aware pre-read cap resolution.
- Cached bundle cap-respect behavior.
- Discover/watch language-aware max-byte behavior.
- Mode-sensitive cap behavior where configured.
- Skip metadata shape and deterministic stage tags.

## Compatibility policy

No legacy extension-only cap behavior is supported. Language-aware defaults are always active.
