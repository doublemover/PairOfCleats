# Triage Records + Context Packs

## Overview
Triage records store vulnerability findings and decisions outside the repo (in the cache). Records are indexed separately and searched with metadata-first filters. Context packs bundle a finding, related history, and repo evidence for LLM workflows.

## Configuration
`.pairofcleats.json` (optional):
```json
{
  "triage": {
    "recordsDir": "",
    "storeRawPayload": false,
    "promoteFields": [
      "recordType",
      "source",
      "recordId",
      "service",
      "env",
      "team",
      "owner",
      "vulnId",
      "cve",
      "packageName",
      "packageEcosystem",
      "severity",
      "status",
      "assetId"
    ],
    "contextPack": {
      "maxHistory": 5,
      "maxEvidencePerQuery": 5
    }
  }
}
```

Defaults:
- `recordsDir`: `<repoCacheRoot>/triage/records`
- `storeRawPayload`: false

## Ingest findings
Dependabot:
```
pairofcleats triage ingest --source dependabot --in dependabot.json --meta service=api --meta env=prod
```

AWS Inspector:
```
pairofcleats triage ingest --source aws_inspector --in inspector.json --meta service=api --meta env=prod
```

Generic (already normalized schema):
```
pairofcleats triage ingest --source generic --in record.json --meta service=api --meta env=prod
```

Each ingest writes:
- `<repoCacheRoot>/triage/records/<recordId>.json`
- `<repoCacheRoot>/triage/records/<recordId>.md`

## Decisions
```
pairofcleats triage decision --finding <recordId> --status accept --justification "..." --reviewer "..."
```

## Exposure metadata
You can attach environment exposure context to records (especially generic/manual):
- `internetExposed` (true/false)
- `publicEndpoint`
- `dataSensitivity`
- `businessCriticality`
- `compensatingControls`

These render in the record markdown and are included in context packs. You can pass them via record JSON or as `--meta` values (for example `--meta exposure.publicEndpoint=https://...` or `--meta internetExposed=true`).

## Build records index
```
pairofcleats index build --mode records --incremental
```

## Search records
```
pairofcleats search "CVE-2024-0001" --mode records --meta service=api --meta env=prod --json
```

Filters:
- `--meta key=value` (repeatable)
- `--meta key` (field exists)
- `--meta-json '{"service":"api","env":"prod"}'`
- `--file`, `--ext` (generic filters applied to records too)

## Context packs
```
pairofcleats triage context-pack --record <recordId> --out context.json
```

The context pack includes:
- `finding` (normalized record)
- `history` (related decisions)
- `repoEvidence` (code/prose search hits)

Context packs assume code/prose indexes exist (`pairofcleats index build`) and the records index is built (`pairofcleats index build --mode records`).

## MCP tools
- `triage_ingest` (wraps ingest)
- `triage_decision` (writes decisions)
- `triage_context_pack` (builds context packs)

These live alongside `search`/`build_index` and support records mode + metadata filters.
