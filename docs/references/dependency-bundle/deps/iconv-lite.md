# `iconv-lite`

**Area:** Text decoding/encoding (streaming)

## Why this matters for PairOfCleats
Decode non-UTF8 files safely and efficiently, especially for large ingestion streams.

## Implementation notes (practical)
- Use streaming APIs (`decodeStream`/`encodeStream`) for large files.
- Handle BOM and normalize line endings if chunk boundaries depend on offsets.

## Where it typically plugs into PairOfCleats
- Ingestion pipeline: detect encoding, decode to UTF-8 for parsers, record original encoding in metadata.

## Deep links (implementation-relevant)
1. Streaming API (decodeStream/encodeStream for large file ingestion) — https://github.com/ashtuchkin/iconv-lite/wiki/Stream-API
2. README: supported encodings + BOM handling notes — https://github.com/ashtuchkin/iconv-lite#readme

## Suggested extraction checklist
- [ ] Identify the exact API entrypoints you will call and the data structures you will persist.
- [ ] Record configuration knobs that meaningfully change output/performance.
- [ ] Add at least one representative test fixture and a regression benchmark.