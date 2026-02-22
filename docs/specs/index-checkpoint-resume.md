# Index Checkpoint Resume

Status: Active v1.0  
Last updated: 2026-02-21T00:00:00Z

## Contract summary

Checkpoint metadata is deterministic and resumable by:

- file cursor
- artifact flush watermark
- checkpoint checksum

## Invariants

- Resume must not replay already-committed artifacts.
- Checkpoint checksum mismatch invalidates resume state.
- Output ordering remains deterministic across fresh vs resumed runs.
