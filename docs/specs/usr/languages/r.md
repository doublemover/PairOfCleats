# USR Language Contract: r

Status: Draft v1.0
Last updated: 2026-02-12T01:45:00Z

## Scope

Normative language contract for `r` under USR.

## Machine-readable linkage

- `tests/lang/matrix/usr-language-profiles.json`
- `tests/lang/matrix/usr-language-version-policy.json`
- `tests/lang/matrix/usr-language-embedding-policy.json`

## Required conformance levels

- `C0`, `C1`, `C2`, `C3`

## Required framework profiles

- none

## Required node kinds

- `call_expr`, `control_stmt`, `function_decl`, `variable_decl`

## Required edge kinds

- `calls`, `contains`, `defines`, `imports`, `references`

## Capability baseline

`supported|partial|unsupported` declarations are authoritative in `usr-language-profiles.json` and must align with required conformance levels.

## Change control

Any Tier 2/Tier 3 change must update this file and synchronized matrix/fixture evidence.
