# Triage Records + Context Packs

## Overview
Triage records store vulnerability findings and decisions outside the repo (in the cache). Records are indexed separately and searched with metadata-first filters. Context packs bundle a finding, related history, and repo evidence for LLM workflows.

## Record defaults

Triage tools use the repository cache's `triage/records` directory. Raw-payload
retention is off by default; context packs use up to five history entries and
five evidence results per query.

The current repository configuration schema does not expose a top-level `triage`
namespace. Do not add `triage.*` to `.pairofcleats.json`: the config loader rejects
it before running the tool. Internal getter options and test-only overrides do
not establish a supported user-facing configuration path.

Use the commands below with their documented CLI inputs and defaults. Consult
the [configuration reference](../config/contract.md) for the currently accepted
repository keys.

## Ingest findings
Dependabot:
```
node tools/triage/ingest.js --source dependabot --in dependabot.json --meta service=api --meta env=prod
```

AWS Inspector:
```
node tools/triage/ingest.js --source aws_inspector --in inspector.json --meta service=api --meta env=prod
```

Generic (already normalized schema):
```
node tools/triage/ingest.js --source generic --in record.json --meta service=api --meta env=prod
```

Each ingest writes:
- `<repoCacheRoot>/triage/records/<recordId>.json`
- `<repoCacheRoot>/triage/records/<recordId>.md`

## Decisions
```
node tools/triage/decision.js --finding <recordId> --status accept --justification "..." --reviewer "..."
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
node tools/triage/context-pack.js --record <recordId> --out context.json
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
