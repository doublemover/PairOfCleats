# Spec: Generated and Vendor Indexing Policy

Status: Draft v1.0  
Last updated: 2026-02-20T00:00:00Z

## Purpose

Define deterministic classification and indexing policy for generated, minified, and vendor files.

## Classification

A file may be classified as generated/vendor based on:

- path patterns,
- filename patterns,
- minified/generated content heuristics,
- explicit repo policy overrides.

## Default behavior

1. Generated/minified/vendor files default to metadata-only indexing.
2. Full indexing requires explicit opt-in patterns in repo config.
3. Classification reasons are emitted in deterministic skip/downgrade metadata.

## Metadata contract

When downgraded to metadata-only, emit:

- `classification`: `generated | minified | vendor`
- `source`: `path-pattern | filename-pattern | content-heuristic | explicit-policy`
- `indexMode`: `metadata-only`
- `reasonCode`

## Override policy

- `indexing.generatedPolicy.include` allows full indexing for explicit patterns.
- `indexing.generatedPolicy.exclude` forces metadata-only indexing for explicit patterns.
- Exclude rules win over include rules.

## Compatibility policy

No legacy generated-file bypass mode is supported.
