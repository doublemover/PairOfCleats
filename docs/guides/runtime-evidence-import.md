# Pinned saved-runtime import

Saved evidence import is offline. It does not execute a project, attach a collector,
or capture a workload. Existing Inspector profiles and versioned code-log inputs
remain supported.

```sh
pairofcleats ingest runtime-evidence --specification import.json --out evidence-dir
```

This form retains raw bytes and truthful file-level evidence. Supplied operation
references are unverified candidates and cannot become authoritative targets.

To verify attribution, supply both the owning repository and the complete pinned
semantic generation JSON copied from its published manifest:

```sh
pairofcleats ingest runtime-evidence --specification import.json --out evidence-dir --repo /path/to/repo --generation '{"baseBuildId":"BUILD_ID","semanticRevision":0}'
```

The selected generation must equal the capture generation. The importer verifies
record existence, partition/source ownership, source hashes and supported source
coordinates against the retained semantic store. Missing, stale or ambiguous
authority cannot authorize an operation target. Explicit scope mismatch fails;
the importer never substitutes another generation silently. The store closes on
success and failure. File `exact-source` identity remains distinct from operation
attribution.

The specification is a bounded contained read. Inputs resolve relative to it.
Imports and claims share destination ownership and retained-byte accounting;
immutable promoted families remain reusable after cancellation. Runtime parsing
consumes the exact bounded bytes verified against each selected manifest.
