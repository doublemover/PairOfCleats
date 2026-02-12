# USR Language Contract: css

Status: Draft v1.0
Last updated: 2026-02-12T05:05:00Z
Owner role: usr-framework
Backup owner role: usr-architecture
Review cadence days: 90
Last reviewed: 2026-02-12T05:05:00Z
Rotation policy: rotate primary reviewer assignment between owner and backup every review cycle.

## Scope

Normative language contract for `css` under USR.

## Machine-readable linkage

- `tests/lang/matrix/usr-language-profiles.json`
- `tests/lang/matrix/usr-language-version-policy.json`
- `tests/lang/matrix/usr-language-embedding-policy.json`

## Required conformance levels

- `C0`, `C1`, `C4`

## Required framework profiles

- `astro`, `nuxt`, `svelte`, `sveltekit`, `vue`

## Required node kinds

- `css_rule`, `directive_expr`, `html_element`, `template_element`

## Required edge kinds

- `contains`, `style_scopes`, `template_binds`, `template_emits`

## Capability baseline

`supported|partial|unsupported` declarations are authoritative in `usr-language-profiles.json` and must align with required conformance levels.

## Change control

Any Tier 2/Tier 3 change must update this file and synchronized matrix/fixture evidence.
