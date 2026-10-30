# Spec: Generated and Vendor Indexing Policy

Status: Active v1.0  
Last updated: 2026-02-22T00:00:00Z

## Purpose

Define deterministic classification and indexing policy for generated, minified, and vendor files.

## Classification

A file may be classified as generated/vendor/minified based on:

- path patterns,
- filename patterns,
- minified/generated content heuristics,
- explicit repo policy overrides.

### Deterministic matrix

| Priority | Rule | Classification | Source | Outcome |
| --- | --- | --- | --- | --- |
| 1 | `indexing.generatedPolicy.exclude` matches path | inferred (or `generated` fallback) | `explicit-policy` | `metadata-only` |
| 2 | `indexing.generatedPolicy.include` matches path | inferred (or `null`) | `explicit-policy` | `full` |
| 3 | minified filename/content heuristic | `minified` | `filename-pattern` or `content-heuristic` | `metadata-only` |
| 4 | vendor path heuristic | `vendor` | `path-pattern` | `metadata-only` |
| 5 | generated path/filename heuristic | `generated` | `path-pattern` or `filename-pattern` | `metadata-only` |
| 6 | no match | `null` | `null` | `full` |

Exclude always wins over include.

Explicit generated-policy includes use the
`explicit-leaf-and-bounded-ancestor-v1` selection contract. Build discovery may
descend through an ignored directory when a matching descendant remains
possible, including `**/node_modules/pkg/keep.js`. That permission alone does not
admit files: exact include matching overrides ordinary ignore admission only for
selected leaves. Unselected siblings and explicit generated-policy exclusions
remain excluded in build and watch paths. Ordinary ignore-file negations retain
their ordered semantics, including later re-exclusion.

The ancestor matcher keeps bounded selector/path states instead of enumerating
hypothetical descendants. Selectors are limited to 4096 characters and 256
relative segments; directory depth, file-count and root boundaries still apply.
Its contract identity participates in the ignore-policy fingerprint, so cached
source admission cannot silently reuse an older traversal meaning.

## Default behavior

1. Generated/minified/vendor files default to metadata-only indexing.
2. Full indexing requires explicit opt-in patterns in repo config.
3. Classification reasons are emitted in deterministic skip/downgrade metadata.

## Metadata contract

When downgraded to metadata-only, emit:

- `classification`: `generated | minified | vendor`
- `source`: `path-pattern | filename-pattern | content-heuristic | explicit-policy`
- `indexMode`: `metadata-only`
- `reasonCode` (`USR-R-GENERATED-METADATA-ONLY`)
- `policy`: `default | include | exclude`
- `matchedPattern`: matched include/exclude glob or `null`

The payload is emitted on downgraded skip entries and must be byte-for-byte stable for identical inputs/config.

## Override policy

- `indexing.generatedPolicy.include` allows full indexing for explicit patterns.
- `indexing.generatedPolicy.exclude` forces metadata-only indexing for explicit patterns.
- Exclude rules win over include rules.

## Compatibility policy

No legacy generated-file bypass mode is supported.
