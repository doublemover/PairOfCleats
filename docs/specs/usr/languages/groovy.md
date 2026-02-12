# USR Language Contract: groovy

Status: Draft v1.0
Last updated: 2026-02-12T05:57:28Z
Owner role: usr-framework
Backup owner role: usr-architecture
Review cadence days: 90
Last reviewed: 2026-02-12T05:05:00Z
Rotation policy: rotate primary reviewer assignment between owner and backup every review cycle.

## Scope

Normative language contract for `groovy` under USR.

## Machine-readable linkage

- `tests/lang/matrix/usr-language-profiles.json`
- `tests/lang/matrix/usr-language-version-policy.json`
- `tests/lang/matrix/usr-language-embedding-policy.json`

## Required conformance levels

- `C0`, `C1`, `C2`, `C3`

## Required framework profiles

- none

## Required node kinds

- `class_decl`, `field_decl`, `interface_decl`, `method_decl`, `param_decl`

## Required edge kinds

- `calls`, `defines`, `extends`, `implements`, `imports`, `references`, `uses_type`

## Capability baseline

`supported|partial|unsupported` declarations are authoritative in `usr-language-profiles.json` and must align with required conformance levels.

## Change control

Any Tier 2/Tier 3 change must update this file and synchronized matrix/fixture evidence.
## Approval checklist

- [ ] Owner-role review completed.
- [ ] Backup-owner review completed.
- [ ] Matrix linkage verified against language/version/embedding registries.
- [ ] Required fixture families assigned with concrete fixture IDs.
- [ ] Required conformance levels mapped to executable lanes.

## Completion evidence artifacts

- `usr-conformance-summary.json` language row updated for this profile.
- `usr-quality-evaluation-results.json` includes required conformance-level evidence.
- `usr-validation-report.json` strict validation output captures this profile's fixture scope.
- `usr-drift-report.json` confirms language-contract and matrix synchronization.



