# Chargram Enrichment and ANN Fallback

Status: Active  
Owner: Indexing + Retrieval  
Last Updated: 2026-02-14

## Purpose
Define optional chargram enrichment and a shared ANN/minhash candidate safety policy with deterministic fallback behavior.

## Chargram Config Surface
- `indexing.postings.chargramFields` (default `['name','doc']`)
- `indexing.postings.chargramStopwords` (default `false`)

Allowed `chargramFields` values:
- `name`
- `signature`
- `doc`
- `comment`
- `body`

## ANN Candidate Safety Config Surface
- `retrieval.annCandidateCap` (default `20000`)
- `retrieval.annCandidateMinDocCount` (default `100`)
- `retrieval.annCandidateMaxDocCount` (default `20000`)

## Candidate Policy (v1)
Reason codes:
- `noCandidates`
- `tooLarge`
- `tooSmallNoFilters`
- `filtersActiveAllowedIdx`
- `ok`

Policy output:
- `null` means run full ANN/minhash set.
- `Set` means constrained candidate set.

## Explain Contract (v1)
When explain is enabled, include:
- policy input candidate size
- resolved output mode (`null` vs constrained set)
- policy reason code

## Versioning Rules
- Candidate policy explain payload uses version `1`.
- Any incompatible shape change requires explain payload version bump.
