# USR Language Contract: go

Status: Draft v1.0
Last updated: 2026-02-12T05:05:00Z
Owner role: usr-framework
Backup owner role: usr-architecture
Review cadence days: 90
Last reviewed: 2026-02-12T05:05:00Z
Rotation policy: rotate primary reviewer assignment between owner and backup every review cycle.

## Scope

Normative language contract for `go` under USR.

## Machine-readable linkage

- `tests/lang/matrix/usr-language-profiles.json`
- `tests/lang/matrix/usr-language-version-policy.json`
- `tests/lang/matrix/usr-language-embedding-policy.json`

## Required conformance levels

- `C0`, `C1`, `C2`, `C3`

## Required framework profiles

- none

## Required node kinds

- `call_expr`, `function_decl`, `module_decl`, `type_alias_decl`, `variable_decl`

## Required edge kinds

- `calls`, `defines`, `extends`, `implements`, `imports`, `references`

## Capability baseline

`supported|partial|unsupported` declarations are authoritative in `usr-language-profiles.json` and must align with required conformance levels.

## Change control

Any Tier 2/Tier 3 change must update this file and synchronized matrix/fixture evidence.
