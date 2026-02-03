# Query Cache

## Goal
Provide an optional persistent cache of search results to speed up repeated queries.

## Config
Enable via `.pairofcleats.json`:
```json
{
  "search": {
    "queryCache": {
      "enabled": true,
      "maxEntries": 200,
      "ttlMs": 0
    }
  }
}
```

## Behavior
- Cache entries are keyed by query + filters + backend + ANN setting.
- Entries are invalidated when index signatures change (mtime/size for index or SQLite db files).
- TTL is optional; `0` disables time-based expiry.
- Cache hits are reported in JSON output at `stats.cache` and logged in `searchHistory` as `cached: true`.
- Payloads include `code`, `prose`, `extractedProse`, and `records` arrays for the active modes.

## Storage
- Cache file: `<cache>/repos/<repoId>/query-cache/queryCache.json`.
