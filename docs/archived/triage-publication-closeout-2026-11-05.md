# Coherent triage publication qualification

On2026-11-05, all21 focused Windows controls for #821 pass at the source hashes in the [machine receipt](triage-publication-closeout-2026-11-05.json). This batch qualifies the existing implementation and restores19 missing ordered CI memberships; it changes no publication semantics or producer version.

The canonical JSON selector chooses one verified immutable JSON/Markdown generation. A per-record cross-process lock serializes same-ID writers while independent IDs remain concurrent. Failed/cancelled staging preserves the prior selector and readable payloads. Exact reimport reuses its verified generation. Inventory and source/replay consumers carry one compact generation witness, recheck actual bytes and reject changed source rather than pairing new metadata with old text.

The16 publication cases include an actual hidden Node writer process, controlled same-ID interleavings, independent IDs, failure after JSON staging/before commit, tampered stage, captured input, cancellation, receipt/type/hash negatives, retained source reads, unknown namespace and original pending-resource recovery. The actual index builder verifies old/current content, metadata and source hashes; its artifact-writing boundary is captured, and post-inventory mutation prevents publication. Five adjacent source/replay/service controls also pass. No replacement loop, retry, larger timeout, physical symlink or editor launch is used.

All eight publication checks pass, including43 gate fixtures. Tests use Node26.13.0 Windowsx64/ABI147, one job,30-second bounds and zero retries/native-status redo. There are no failures, timeouts or skips. Lane governance reports no missing IDs, duplicates, manifest mismatches or timing overruns; ci-lite now contains2138 cases. Exact reports and file digests are retained; author-workspace .tmp/.testLogs paths are historical provenance.

This is coherence/source qualification, not a new full-index, latency or cross-platform campaign. The [ownership contract](../contracts/triage-record-publication.md) describes actual publication boundaries. Changed-head hosted CI remains separate.
