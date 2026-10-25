# Index validation findings and verdicts

Validation findings retain mode ownership, capability, stable code, severity,
artifact, state, detail and presentation strings. Missing artifacts, invalid
content/identity and unverified reads are separate states; optional warnings
retain their warning severity. Ownership is supplied at the producing check,
never recovered by parsing a displayed mode prefix.

All validation helpers publish through the same finding owner. Manifest piece
workers merge in original manifest order, including deferred checksum completion
at its original diagnostic anchor. The final report is reconciled only after
manifest finalization and backend checks. Mode and aggregate booleans derive from
that canonical collection, without another artifact read. SQLite/LMDB findings
declare capability and, where known, mode separately; a backend-wide finding
does not falsely invalidate another mode's artifact content.

Existing global issue/warning strings remain projections in their original
order. Modes also retain `state`, `missing`, `invalid`, `unverified` and warnings.
Human output distinguishes these states, and genuine errors still produce a
nonzero aggregate CLI exit. A present corrupt identity cannot be summarized as a
missing artifact or a healthy mode. No validation check or authority is relaxed.

Authored two-mode capsules cover collisions, fractional posting IDs, invalid
metadata schema, embedding identity mismatch, deferred checksum failure, missing
pieces, read failure, optional warnings and human/JSON output. They assert both
directions of mode isolation and preserve existing contract-matrix assertions.
The checksum mismatch fixture now supplies a correctly sized false SHA-1 rather
than a malformed eight-character digest, so it reaches the intended mismatch
comparison. Functional Windows execution remains deferred.
