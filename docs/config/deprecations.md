# Config Deprecations

This document tracks deprecated config keys and their replacements.

## Removed deprecations
- `sqlite.dbPath` -> `sqlite.dbDir` or `sqlite.codeDbPath`/`sqlite.proseDbPath`
  - Single database paths are legacy; split DBs are the default.
- `sqlite.annMode` -> `sqlite.vectorExtension.annMode`
- `indexing.fileCaps.defaults` -> `indexing.fileCaps.default`
- `indexing.fileCaps.byExtension` -> `indexing.fileCaps.byExt`
- `indexing.fileCaps.byLang` -> `indexing.fileCaps.byLanguage`
- `cache.runtime.*.maxMB` -> `cache.runtime.*.maxMb`
- `cache.runtime.*.ttlMS` -> `cache.runtime.*.ttlMs`

These keys are no longer accepted. Update configs to the replacement keys.
