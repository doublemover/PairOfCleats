# Query Cache

## Goal
Provide an optional persistent cache of search results to speed up repeated queries.

## Configuration and effective policy

The current result-cache enablement follows effective quality policy; it is off
for `fast` and enabled for other resolved quality modes. Use the supported
high-level choice, for example this complete schema-valid config:

<!-- poc:recipe query-cache-config kind=config effects=read-only -->
```json
{ "quality": "balanced" }
```

Inspect `config dump --repo <target> --json` and the current retrieval consumer.
`search.queryCache` is not accepted by the current schema; merely renaming it to
`retrieval.queryCache` does not create a supported public knob. Entry limits/TTL
are runtime-owned defaults, not the old copied `enabled/maxEntries/ttlMs` recipe.
See [configuration](configuration.md) before adding a proposed setting.
## Behavior
- Cache entries are keyed by query + filters + backend + ANN setting.
- Entries are invalidated when index signatures change (mtime/size for index or SQLite db files).
- TTL is optional; `0` disables time-based expiry.
- Cache hits are reported in JSON output at `stats.cache` and logged in `searchHistory` as `cached: true`.
- Payloads include `code`, `prose`, `extractedProse`, and `records` arrays for the active modes.

## Storage
- Cache file: `<cache>/repos/<repoId>/query-cache/queryCache.json`.

Query result-cache writers acquire the cache file lock, merge fresh disk entries
with the request snapshot, then prune and replace the file. Independent queries
therefore retain each other's completed entries. Disk query-plan restoration
inserts older entries first so subsequent capacity eviction keeps newer plans.
Serialized query-plan schema 2 also invalidates prior highlight planning.

Extracted-comment joins are prepared only when final, context-expanded code hits
need missing excerpts. Their weak metadata-array owner assumes admitted metadata
is immutable; replacement of that array admits a new generation. Hits receive
request-owned excerpt objects. Working-source body summaries include file identity,
size and nanosecond modification/change times in both text and rendered keys.
