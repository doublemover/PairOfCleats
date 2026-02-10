# Spec -- USR Normalization Mapping Contract

Status: Draft v0.5
Last updated: 2026-02-10T08:15:00Z

## 0. Purpose and scope

This document defines deterministic mapping of raw parser/compiler syntax kinds into USR normalized node kinds.

It decomposes `docs/specs/unified-syntax-representation.md` sections 8.2, 11.4, 13, and provenance-related requirements in section 39.

## 1. Canonical mapping schema

```ts
type USRNodeKindMappingRuleV1 = {
  languageId: string; // or "*" for global fallback
  parserSource: "native-parser" | "tree-sitter" | "framework-compiler" | "tooling" | "heuristic" | "*";
  rawKind: string;
  normalizedKind: string; // USRNormNodeKind
  category: string; // USRNodeCategory
  confidence: number; // 0..1
  priority: number; // lower is stronger precedence
  provenance: "parser" | "compiler" | "adapter" | "manual-policy";
  languageVersionSelector?: string | null; // optional dialect/version discriminator
  notes?: string;
};
```

Registry file:

- `tests/lang/matrix/usr-node-kind-mapping.json`

## 2. Deterministic mapping algorithm (normative)

Given `(languageId, parserSource, rawKind)`:

1. exact match on `(languageId, parserSource, rawKind)` with lowest `priority`
2. match `(languageId, "*", rawKind)` with lowest `priority`
3. match `("*", parserSource, rawKind)` with lowest `priority`
4. match `("*", "*", rawKind)` with lowest `priority`
5. unknown-kind handling policy (section 5)

Tie-breakers:

- lower `priority` wins
- then lexical `normalizedKind`
- then lexical `category`

## 3. Conflict rules

Mapping conflicts are schema errors in strict mode.

Conflict classes:

- duplicate key with different target `normalizedKind`
- incompatible category assignments for same mapping key
- non-deterministic equal-priority conflicting rows

Required behavior:

- strict mode: reject mapping registry and emit `USR-E-SCHEMA-VIOLATION`
- non-strict mode: choose deterministic winner and emit `USR-W-CANONICALIZATION-FALLBACK`

## 4. Family-level baseline mappings (normative minimums)

The following raw-kind families MUST be covered:

| Family | Raw kind examples | Required normalized kind |
| --- | --- | --- |
| function declarations | `FunctionDeclaration`, `function_definition`, `function_declaration` | `function_decl` |
| method declarations | `MethodDefinition`, `method_declaration` | `method_decl` |
| class/type declarations | `ClassDeclaration`, `class_specifier`, `class_declaration` | `class_decl` |
| import/export | `import_statement`, `export_statement`, `import_clause` | `import_stmt`, `export_stmt` |
| invocation | `CallExpression`, `call_expression`, `invocation_expression` | `call_expr` |
| template elements | `VElement`, `JSXElement`, `Element`, `SvelteElement` | `template_element` or `html_element` per profile |
| style rules | `rule_set`, `qualified_rule`, `style_rule` | `css_rule` |
| control statements | `if_statement`, `switch_statement`, `for_statement` | `control_stmt` |

## 5. Unknown-kind handling policy (normative)

When no mapping is found:

- `normalizedKind` MUST be `unknown`
- `category` MUST be `unknown`
- `rawKind` MUST be preserved unchanged
- producer MUST emit `USR-W-CANONICALIZATION-FALLBACK`

Unknown kinds MUST NOT be silently dropped.

Unknown-kind budget policy:

- per language and parser source, unknown-kind rate MUST be reported
- if unknown-kind rate exceeds configured budget, strict conformance lanes MUST fail
- unknown kinds MAY remain only when explicitly allowlisted by language contract and fixture IDs

## 6. Framework/compiler mapping overlays

Framework compilers may emit AST kinds with no parser-equivalent names.

Rules:

- overlay mapping rows MUST include `parserSource="framework-compiler"`
- profile-specific rows MUST be gated by framework profile applicability
- generic parser rows MUST NOT override explicit framework rows

## 7. Validation and drift policy

Required checks:

- every `normalizedKind` value exists in canonical USR enum
- no duplicate conflicting mapping rows
- deterministic ordering of mapping rows in registry output
- coverage report for top-N observed raw kinds per language

Outputs:

- `usr-node-kind-mapping-coverage.json`
- `usr-node-kind-mapping-conflicts.json` (on failure)
- `usr-node-kind-mapping-unknown-budget.json`
- `usr-generated-provenance-cases.json` linkage report for mapping rows with generated/macro provenance

## 8. Registry ordering and canonical serialization requirements

`usr-node-kind-mapping.json` entries MUST be serialized in canonical sorted order:

1. `languageId` lexical (`*` last)
2. `parserSource` lexical (`*` last)
3. `rawKind` lexical
4. `priority` numeric ascending
5. `normalizedKind` lexical

Writers MUST preserve this order across reruns for identical source inputs.

## 9. Minimum schema strictness requirements

Strict validators MUST enforce:

- `confidence` in `[0,1]`
- `priority >= 0`
- non-empty `rawKind`
- `normalizedKind` and `category` from canonical enums
- non-empty `provenance`
- disallow unknown keys unless explicitly namespaced extension fields are enabled

## 10. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-language-profile-catalog.md`
- `docs/specs/usr-framework-profile-catalog.md`
- `docs/specs/usr-generated-provenance-contract.md`
- `docs/specs/usr-registry-schema-contract.md`


