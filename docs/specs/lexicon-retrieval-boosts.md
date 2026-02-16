# Lexicon Retrieval Boosts

Status: Active  
Owner: Retrieval  
Last Updated: 2026-02-14

## Purpose
Add optional, bounded, boost-only ranking signals based on relation alignment between query tokens and chunk/file relations.

## Scope
- Boost-only. Never filters hits.
- Uses query tokens from `buildQueryPlan(...)`.
- Uses lexicon `ranking` stopwords to suppress boilerplate tokens.

## Scoring Contract
For each hit:
- `callMatches = |signalTokens intersect callBaseSet|`
- `usageMatches = |signalTokens intersect usageSet|`
- `boost = min(maxBoost, callMatches*perCall + usageMatches*perUse)`

Recommended defaults:
- `perCall = 0.25`
- `perUse = 0.10`
- `maxBoost = 1.50`

## Config Surface
- `retrieval.relationBoost.enabled` (default `false`)
- `retrieval.relationBoost.perCall`
- `retrieval.relationBoost.perUse`
- `retrieval.relationBoost.maxBoost`

## Explain Contract (v1)
When explain is enabled, include:
- `enabled`
- `callMatches`
- `usageMatches`
- `boost`
- bounded token lists and configured caps/weights

## Versioning Rules
- Explain payload shape is versioned independently from lexicon wordlists.
- Current explain payload version is `1`.
- Any incompatible explain field rename/removal must bump explain payload version.
