# SQLite ANN Extension

PairOfCleats can optionally use a loadable SQLite vector extension (for example,
sqlite-vec) to execute ANN queries inside SQLite. This is optional and falls
back to the JS ANN path when the extension or vector table is unavailable.

## Setup

Native loading requires a user-approved source URL and SHA256 digest in a
user-owned configuration file outside every repository being indexed. An
untrusted repository's `.pairofcleats.json` cannot grant native-loading authority.
See [execution authority](../guides/execution-authority.md#configuration-sources).
Keep this configuration in permanent user storage, rather than a temporary test
file; select it through `PAIROFCLEATS_TRUSTED_CONFIG`.

For a new Windows x64 setup, the following PowerShell commands pin sqlite-vec
v0.1.9's official loadable archive. If you already have trusted configuration or
redirect origins, merge these entries into those settings instead of replacing
them. Do not put the trusted file under a repository or commit the local binary.

```powershell
$trustedConfig = Join-Path $env:LOCALAPPDATA 'PairOfCleats/config/trusted.json'
if (Test-Path -LiteralPath $trustedConfig) {
  throw 'Merge the sqlite.vectorExtension.downloads entry into the existing trusted config.'
}
New-Item -ItemType Directory -Path (Split-Path $trustedConfig) -Force | Out-Null
$config = @{
  sqlite = @{
    vectorExtension = @{
      downloads = @{
        'win32-x64' = @{
          url = 'https://github.com/asg017/sqlite-vec/releases/download/v0.1.9/sqlite-vec-0.1.9-loadable-windows-x86_64.tar.gz'
          sha256 = '51581189d52066b4dfc6631f6d7a3eab7dedc2260656ab09ca97ab3fb8165983'
        }
      }
    }
  }
}
$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $trustedConfig
$env:PAIROFCLEATS_TRUSTED_CONFIG = $trustedConfig
$env:PAIROFCLEATS_DOWNLOAD_REDIRECT_ORIGINS = '["https://release-assets.githubusercontent.com"]'
[Environment]::SetEnvironmentVariable('PAIROFCLEATS_TRUSTED_CONFIG', $trustedConfig, 'User')
[Environment]::SetEnvironmentVariable('PAIROFCLEATS_DOWNLOAD_REDIRECT_ORIGINS', $env:PAIROFCLEATS_DOWNLOAD_REDIRECT_ORIGINS, 'User')
node tools/config/validate.js --config $trustedConfig --json
node tools/download/extensions.js --repo .
node tools/sqlite/verify-extensions.js --repo . --load --json
```

User-level environment settings apply to newly launched terminals and apps. The
`$env:` assignments also configure the current shell. The GitHub release-assets
origin is an explicit redirect allowance; the archive's pinned SHA256 remains
mandatory. The download helper verifies and registers the archive and extracted
binary. Repeated installs reuse the registered binary only while its provenance
and current hash match. The runtime rechecks integrity before native loading.

`pairofcleats assets extensions` and `pairofcleats assets extensions-verify --load`
are the installed CLI equivalents. `extensions-verify --no-load` checks artifact
integrity without executing native code. The setup command also checks extension
readiness using this same trusted configuration and registration.

## Configuration

- Default provider: sqlite-vec (`vec0` module).
- `sqlite.vectorExtension.downloads` is keyed by `<platform>-<arch>`, such as
  `win32-x64`. Each entry must name an immutable URL and approved SHA256 digest.
- Other platforms require their own official archive and digest; the Windows
  archive above cannot be used on macOS or Linux.
- The helper supports `.zip`, `.tar`, `.tar.gz` and `.tgz` archives. It extracts
  the configured filename or platform binary suffix into the extensions cache.
- `sqlite.vectorExtension.path` overrides the `dir` + `filename` layout. Custom
  paths and sources belong in the user-owned trusted file.
- `annMode` defaults to `auto`; set it to `extension` to request the extension,
  or `js` to select the JS path.
- `table`, `column` and `encoding` default to `dense_vectors_ann`, `embedding`
  and `float32`. Use `options` for supported extension-specific settings.

Rebuild the SQLite indexes after installing the extension so the ANN table is
created. Installation does not rebuild existing indexes.

## Build
```
pairofcleats sqlite build
```
When the extension loads successfully, the build creates `dense_vectors_ann` and
stores float32 embeddings for ANN queries.
If code and prose share the same SQLite db path, the ANN table is scoped per mode
(`dense_vectors_ann_code`, `dense_vectors_ann_prose`) to avoid collisions.

## Incremental updates
- Incremental SQLite updates delete and reinsert ANN rows for changed chunks.
- When the extension is unavailable, incremental updates proceed without the
  ANN table and emit a warning (ANN falls back to JS until rebuilt).

## Search
```
pairofcleats search --backend sqlite "query"
```
If the extension or table is missing, `search.js` warns and uses the JS ANN     
implementation instead.

sqlite-vec currently indexes merged vectors only. When `denseVectorMode` resolves to `code`, `doc`, or `auto`, sqlite-vec ANN is disabled for that run and search falls back to other ANN backends.

Candidate set behavior:
- When filters provide an ID candidate set, SQLite ANN pushes the set into the query when the set is small (≤ 900 IDs).
- Larger candidate sets fall back to a best-effort query (over-fetch then filter), with a warning emitted once per run.

## Notes
- Extensions are stored outside the repo under the cache root.
- Environment overrides: `PAIROFCLEATS_EXTENSIONS_DIR`, `PAIROFCLEATS_VECTOR_EXTENSION`.
- `cache clean` keeps extensions; `pairofcleats uninstall` removes them.
- The extension table is optional and not required for SQLite to work.
- `dense_vectors_ann` stores float32 embeddings, which increases SQLite size.
- `dense_vectors_ann` uses `rowid` = `doc_id` for lookups.
- `dense_vectors` and `dense_vectors_ann` should have matching row counts per
  mode when ANN is enabled (no orphaned ANN rows).
