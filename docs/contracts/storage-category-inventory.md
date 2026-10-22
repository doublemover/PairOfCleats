# Read-only category inventory

This source and its regression fixtures are **UNVALIDATED**. No CLI,
embedding/profile scan, user-cache inspection or runtime acceptance was run.

`tools/storage/category-inventory.js:inspectStorageCategory()` is the common
structured entry used by the actual `storage inspect` command. It routes
complete command-probe producer identity, dictionary consumer/manifest bytes,
and the existing strict embedding index/reference reader. Known owner adapters
do not grant deletion or generic migration authority. Unknown/pinned/future
metadata fields and missing/incomplete/reference failures remain protected.

`storage inspect --category command-probes` uses the current compatibility probe
location; `--category dictionaries` uses the current dictionary location.
`--path <absolute-root>` explicitly selects read-only inspection scope. Ordinary
logical descriptor categories filter the shared root inventory. Registered roots
and scanned bytes remain separate, and active/unknown owners prevent an idle
category claim. Command-probe observations include a second lease read and
file-object checks; they explicitly are not a filesystem snapshot.

Embedding inspection requires the explicit cache root and a complete identity:

```text
storage inspect --category embedding-profiles --path <embedding-cache-root> --plan <profile-request.json> --json
```

The request contains `schemaVersion: 1`,
`kind: "embedding-storage-profile-request"`, `identity` from the existing full
embedding identity owner, and optional `repoId`. This is a read-only request,
not apply authority. The adapter calls `readCacheIndex(..., {strict:true})`,
including `cache.index.delta`, and existing immutable reference protection.
Legacy tuple data remains a read-only fallback tier; unrelated profiles are
never recursively treated as legacy files. Unsafe byte sums remain unknown.
No lock is created/recovered and no index is repaired by inspection.
