# Cross-file symbol resolution (native heuristic resolver) — Draft v1

> **Status:** Draft for Phase 9. Needs another pass once the first implementation exists and we can validate real-world failure modes + performance.

## Why this spec exists

Phase 9 introduces **cross-file linking** that is:
- **import-aware** (uses import bindings and import resolution to narrow candidates), and
- **ambiguity-preserving** (never “guess-links” when multiple plausible targets exist).

This document standardizes the **inputs**, **data contracts**, **resolution algorithm**, and **determinism requirements** so implementation work does *not* start with repo-wide searching or implicit assumptions.

## Scope

In Phase 9, the resolver supports:
- **Relative imports only** for module specifier → file resolution (e.g., `./foo`, `../bar`, `./foo/index`).
- **Static bindings** extracted from language parsing (ESM `import`, basic CJS `require` assignments where available).
- **Heuristic, bounded matching** (no type-checker required).

Out of scope (explicitly Phase 9 non-goals):
- Full Node/TS module resolution parity (`package.json` exports/imports, `tsconfig` paths, Yarn PnP, etc).
- Whole-program dynamic resolution.

## Canonical vocabulary

This resolver produces **SymbolRef** objects and edges as specified in:
- `docs/specs/symbol-identity-and-symbolref.md`
- `docs/specs/symbol-artifacts.md`

If this draft conflicts with those specs, **those specs win**; update this draft.

## Inputs

### 1) `file_relations.relations.importBindings` (new)

Each `file_relations` entry MAY include an `importBindings` array describing **local binding names** created by imports, and where they came from.

#### Contract: `ImportBindingV1`

```ts
type ImportBindingKind = "named" | "default" | "namespace" | "sideEffect";

type ImportBindingV1 = {
  v: 1;

  // local identifier introduced into the importing module, if any
  localName: string | null;

  // module specifier as written in source (e.g. "./utils", "react")
  moduleSpecifier: string;

  // import form:
  // - named:      import { foo as bar } from "m"  -> importedName="foo", localName="bar"
  // - default:    import foo from "m"             -> importedName="default", localName="foo"
  // - namespace:  import * as foo from "m"        -> importedName="*", localName="foo"
  // - sideEffect: import "m"                      -> localName=null, importedName=null
  kind: ImportBindingKind;

  // For kind="named", the exported name from the module (before aliasing).
  // For kind="default", use "default".
  // For kind="namespace", use "*".
  importedName: string | null;

  // Optional: filled if the moduleSpecifier resolved to a local repo file.
  // Phase 9 only guarantees relative resolution.
  resolvedFile: string | null;

  // Optional: whether the binding is type-only (TS/Flow). Prefer null if unknown.
  isTypeOnly: boolean | null;

  // Optional evidence. Helpful but not required.
  loc?: {
    startLine: number | null;
    startCol: number | null;
    endLine: number | null;
    endCol: number | null;
  } | null;
};
```

**Determinism requirements:**
- `importBindings` MUST be emitted in a stable order:
  1) by `moduleSpecifier`,
  2) then by `kind`,
  3) then by `localName`,
  4) then by `importedName`.

### 2) Import resolution helpers (relative only)

The resolver needs to map `moduleSpecifier` → `resolvedFile` for relative specifiers.

Implementation should prefer reuse of Phase 3 logic where possible:
- `src/index/build/import-resolution.js` (candidate probing rules)
- `file_relations.relations.importLinks` (already produced file-level import graph)

If a standalone helper is used, it MUST match Phase 3’s relative resolution behavior:
- `./x` probes: `./x`, `./x.js`, `./x.ts`, `./x.jsx`, `./x.tsx`, `./x/index.*`
- Directory index behavior: `./x/index.(js|ts|jsx|tsx|...)`
- Case sensitivity follows the underlying FS / repo rules.

### 3) A native symbol index

The resolver consumes a **symbol index** built from `chunk_meta[].metaV2.symbol` (definition chunks).

At minimum, index these keys:
- `byQualifiedName` (exact string)
- `byLeafName` (last identifier segment)
- `byExportedName` (if export info is available later)
- optionally `byModuleFile` (`virtualPath` / container file)

Each candidate in the index MUST retain:
- `chunkUid`
- `symbolId` (preferred) and/or `scopedId`/`symbolKey`
- `kindGroup`
- `qualifiedName`
- `signatureKey` (if present)

## Resolution outputs

Resolution returns a **SymbolRef** per `docs/specs/symbol-identity-and-symbolref.md`, with:
- `state: "resolved" | "ambiguous" | "unresolved"`
- `candidates[]` populated for ambiguous/unresolved, capped to a small number (default 8)
- optional `evidence` including:
  - callsite / usage location
  - import narrowing info (`moduleSpecifier`, `resolvedFile`)
  - match reasons

### Candidate metadata

This spec standardizes optional fields that improve explainability:

```ts
type CandidateReasonCode =
  | "name_exact"
  | "name_leaf"
  | "qualified_exact"
  | "import_binding_match"
  | "import_file_match"
  | "kind_hint_match"
  | "signature_hint_match"
  | "export_hint_match";

type SymbolCandidateV1 = {
  symbolId?: string;
  scopedId?: string;
  symbolKey?: string;
  signatureKey?: string;
  chunkUid?: string;
  kindGroup?: string;
  qualifiedName?: string;

  // Optional: numerical score used to rank candidates
  score?: number;

  // Optional: reasons for inclusion (small, stable list)
  reasons?: CandidateReasonCode[];
};
```

**Determinism requirements:**
- Candidate ordering MUST be stable: sort by `score desc`, then by `symbolId/scopedId/symbolKey asc`, then by `chunkUid asc`.

## Algorithm (normative)

### Step 0 — Normalize the reference name

Given a raw reference string (callee, usage):
- Compute `name` (the “target name”) as the full dotted name if present, else identifier.
- Compute `leafName` as the last segment after `.`.
- Extract `receiver` if the reference is a `receiver.leafName` form.

### Step 1 — Apply import-aware narrowing (when possible)

Given the containing file’s `importBindings`:

1) If `receiver` exists:
   - If there is a binding with `localName === receiver`, treat it as an import match and record:
     - `moduleSpecifier`
     - `resolvedFile` (if available)
     - `importedName` (if named/default/namespace)
2) Else (no receiver):
   - If there is a binding with `localName === name` (direct call to imported function), treat as an import match.

If `resolvedFile` is present and points to a repo file:
- Prefer candidates defined in that file (or its virtual path variants).

### Step 2 — Candidate collection (bounded)

Collect candidates from the native symbol index:
- `qualifiedName` exact matches (if the reference includes dots and index supports it)
- `leafName` matches
- optionally `name` matches (non-dotted) if different from leaf

Deduplicate by preferred identity key:
- prefer `symbolId` if present
- else `scopedId`
- else (`symbolKey`, `chunkUid`)

Hard cap: keep only the top `N=50` raw candidates before scoring, to avoid pathological blowups.

### Step 3 — Scoring (heuristic, bounded)

Assign each candidate a score using additive weights:

| Signal | Weight |
|---|---:|
| `qualifiedName` exact match | +3.0 |
| `leafName` exact match | +2.0 |
| receiver binding matched | +1.5 |
| candidate is in `resolvedFile` | +2.5 |
| `kindGroup` matches `kindHint` | +0.5 |
| signature hint match | +0.5 |

Recommended thresholds:
- `resolved` if:
  - top score ≥ **4.0**, and
  - top score − second score ≥ **1.0**
- else:
  - `ambiguous` if there are ≥2 candidates
  - `unresolved` if no candidates

These numbers are intentionally conservative (favor ambiguous over wrong).

### Step 4 — Emit SymbolRef

- If resolved: emit `state="resolved"` and include the chosen identity fields + `chunkUid`.
- If ambiguous: emit `state="ambiguous"` with `candidates` (top 8) and optional evidence.
- If unresolved: emit `state="unresolved"`; `candidates` may be empty.

## Evidence fields (recommended)

Where available, include:

```ts
evidence: {
  sourceFile?: string;
  sourceChunkUid?: string;
  loc?: { startLine, startCol, endLine, endCol };
  moduleSpecifier?: string;
  resolvedFile?: string | null;
  receiver?: string | null;
  leafName?: string;
}
```

Evidence MUST NOT include entire code strings or large payloads.

## Integration points (Phase 9)

- `src/lang/javascript/relations.js`: extract `importBindings`.
- `src/index/type-inference-crossfile/*`: use import bindings + relative import resolution to populate `SymbolRef` targets.
- `src/index/build/artifacts/writers/*`: emit `symbol_edges` based on resolved `callLinks`/`usageLinks`.

## Open questions (needs another pass)

- How to represent re-exports (`export {x} from "./m"`) in `importBindings` vs `export` metadata.
- Whether to treat namespace imports (`import * as ns`) as “receiver match” only, or to attempt member resolution via exported symbol sets.
- How to incorporate provider-backed symbol IDs (SCIP/LSIF/LSP) into candidate selection when available.
