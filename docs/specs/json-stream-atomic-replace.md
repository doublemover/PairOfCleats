# Spec: JSON Streaming Writers, Sharding-by-Compressed-Bytes, and Atomic Replace Hygiene (Phase 4.6 + 4.11)

Status: Implemented active contract
Last audited: 2026-05-21

This spec covers:

1. Forwarding gzip options correctly to the gzip stream implementation.
2. Enforcing `maxBytes` sharding based on **post-compression bytes** actually produced/written.
3. Making atomic replace (`replaceFile`) not leak `.bak` files by default for JSON streaming outputs.

---

## 1. Goals

* **Correctness:** sharded JSONL outputs must respect `maxBytes` based on compressed size when compression is enabled.
* **Determinism:** shard metadata "bytes" should mean actual on-disk bytes for that shard.
* **Reliability:** atomic replace should not leave `.bak` artifacts after a successful write unless explicitly requested.
* **Performance:** the solution must remain streaming-first and avoid buffering whole shards in memory.

---

## 2. Current implementation

Primary modules:

* `src/shared/json-stream/compress.js`
  * `normalizeGzipOptions()` supports the deterministic gzip subset (`level`, `mem`, `mtime`), defaults `level` to 6, defaults `mtime` to 0, clamps invalid levels, and warns once for unsupported keys.
  * `createFflateGzipStream(options)` passes normalized gzip options to `fflate.Gzip`.
* `src/shared/json-stream/byte-counter.js`
  * `createByteCounter(maxBytes, highWaterMark, checksumAlgo)` counts post-transform bytes, optionally computes checksums, and fails fast when the emitted byte stream exceeds `maxBytes`.
* `src/shared/json-stream/streams.js`
  * `createJsonWriteStream(filePath, options)` returns `{ stream, getBytesWritten, checksumAlgo, getChecksum, done }`.
  * Compression pipelines count bytes after gzip/zstd and before the file stream.
  * Atomic writes use temp files and `replaceFile()` after stream completion.
* `src/shared/json-stream/jsonl-sharded.js`
  * `writeJsonLinesSharded()` and `writeJsonLinesShardedAsync()` write into a sibling temp parts directory, record finalized shard sizes from `getBytesWritten()`, and swap the complete directory into place through `replaceDir()`.
* `src/shared/io/replace-file.js`
  * `replaceFile(tempPath, finalPath, { keepBackup = false })` removes the transient `.bak` after a successful replace unless explicitly retained.
* `src/shared/io/replace-dir.js`
  * `replaceDir(tempPath, finalPath, { keepBackup = false })` swaps sharded output directories atomically where possible, falls back to durable copy/rollback when needed, and removes transient backups unless explicitly retained.

---

## 3. Forward gzip options correctly

### 3.1 Supported gzip options

`gzipOptions` supports a safe subset that is:
* available in `fflate` gzip stream
* deterministic
* useful

Supported:
* `level` (0-9)
* `mem`
* `mtime`

If `fflate` does not support a requested option, we must:
* ignore it
* emit a warning once per run

This keeps configs portable while making the limitation visible.

### 3.2 Implementation details

`createFflateGzipStream(options)` passes normalized `options.gzipOptions` into the fflate Gzip constructor.

Normalization:
* if `options.gzipOptions.level` is undefined, default to 6
* clamp out-of-range levels and warn once
* if `options.gzipOptions.mtime` is not finite, default to 0

---

## 4. Sharding based on post-compression bytes

### 4.1 What "post-compression bytes" means
For `compress = null`:
* post-compression bytes == bytes written to the shard file stream.

For `compress = 'gzip' | 'zstd'`:
* post-compression bytes == bytes emitted by the compression stream and passed to the file stream.

The implementation uses a byte-counting transform on the data path *after* compression, *before* `fs.WriteStream`.

### 4.2 ByteCounter transform
Implemented in `src/shared/json-stream/byte-counter.js`:

```js
function createByteCounter(maxBytes, highWaterMark, checksumAlgo = null) {
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      if (maxBytes > 0 && bytes > maxBytes) {
        cb(new Error(`JSON stream exceeded maxBytes (${bytes} > ${maxBytes}).`));
        return;
      }
      cb(null, chunk);
    }
  });
  return {
    counter,
    getBytes: () => bytes,
    isOverLimit: () => bytes > maxBytes,
  };
}
```

Pipeline (compress example):
```
writerStream (gzip|zstd) -> byteCounter.counter -> fsWriteStream
```

No compression:
```
byteCounter.counter -> fsWriteStream
```

### 4.3 Bytes written contract

`createJsonWriteStream()` returns:
```ts
{
  stream: Writable;       // what callers write JSON to (gzip/zstd/counter)
  done: Promise<void>;    // resolves after fsWriteStream finishes
  getBytesWritten: () => number; // post-compression bytes produced so far
  checksumAlgo: string | null;
  getChecksum: () => string | null;
}
```

### 4.4 Shard-roll algorithm
Within `writeJsonLinesSharded` and `writeJsonLinesShardedAsync`:

* Maintain `currentWriter` for current shard.
* After writing each record (including newline), call:
  * `await current.writeLine(lineBuffer, lineBytes)`
  * `const shardBytes = current.getBytesWritten()`
* If the current shard reaches its item or byte boundary and there are remaining records:
  * close the shard
  * start next shard
* After all shards complete:
  * swap the complete temp parts directory into place through `replaceDir(tempPartsDir, partsDir)`

**Shard boundary rule:** never split a record across shards. Shards roll only between records.

### 4.5 Metadata semantics
Shard metadata produced by `writeJsonLinesSharded` ensures:
* `bytes[i]` equals the on-disk bytes of shard file i after compression.

Callers that treat "bytes" as a rough metric continue to work; callers that use it for budget enforcement use the corrected on-disk metric.

### 4.6 Zstd specifics
`createZstdStream` is chunked; output is emitted incrementally. The byte counter will naturally track what is written.

---

## 5. Atomic replace and `.bak` hygiene

### 5.1 Problem definition
Historical problem:

`replaceFile(tmpPath, finalPath)` previously:
1. renames existing final to `finalPath + '.bak'`
2. renames tmp to final
3. leaves `.bak` indefinitely

For JSONL shards and meta files, leaving `.bak`:
* wastes disk space
* creates confusion about "real" artifacts
* can cause future tooling to pick up wrong files if globbing is naive

### 5.2 Best-version choice: keep backups opt-in
Current contract:
```ts
replaceFile(tmpPath, finalPath, { keepBackup?: boolean } = {})
```

Defaults:
* `keepBackup = false`

Behavior:
* If `keepBackup=false`:
  * if a `.bak` was created, remove it after the replace succeeds
* If `keepBackup=true`:
  * preserve existing semantics

### 5.3 Safety rule for cleanup
Only remove `.bak` if:
* replace succeeded AND
* finalPath exists

Implementation cleanup is gated on a successful replace and uses the shared persistence helper cleanup path.

### 5.4 Sharded directory swaps
Sharded JSONL outputs are swapped atomically as a **directory**, not by deleting the existing shard set up front.

Rules:
* Write shards into a temp directory sibling of the final parts directory.
* Once all shards and meta files are written, rename the temp directory into place.
* If a prior parts directory exists, move it to a `.bak` path and delete after swap succeeds.
* On failure, keep the old directory intact and clean up the temp directory.

---

## 6. Test Coverage

### 6.1 Sharding uses compressed bytes
Covered by:

* `tests/shared/json-stream/maxbytes-enforced.test.js`
* `tests/shared/json-stream/typedarray-sharded.test.js`
* `tests/indexing/repo-map/roundtrip.test.js`
* `tests/shared/artifact-io/manifest-streaming.test.js`

The tests assert sharding, max-byte enforcement, typed-array serialization, and artifact manifest byte metadata.

**Note:** shard rolling remains record-boundary based. A single row larger than `maxBytes` fails with `ERR_JSON_TOO_LARGE`; rows are never split across shards.

### 6.2 gzip options forwarded
Covered by:

* `tests/shared/json-stream/gzip-options-forwarded.test.js`
* `tests/shared/json-stream/compress-options.test.js`

### 6.3 replaceFile cleanup
Covered by:

* `tests/shared/json-stream/atomic-replace.test.js`
* `tests/shared/json-stream/atomic-stale-backup-protection.test.js`
* `tests/shared/json-stream/atomic-dir-replace-fallback-rollback.test.js`

---

## 7. Maintenance Rules

* Keep the split owner modules authoritative. Do not recreate the removed `src/shared/json-stream.js` facade.
* New artifact writers that use JSONL shards must route through `writeJsonLinesSharded()` or `writeJsonLinesShardedAsync()` instead of hand-rolling per-shard temp files.
* New compressed JSONL writers must pass gzip/zstd options through the normalized compression helpers.
* New atomic JSON or JSONL writes should keep backups opt-in. Default successful writes must not leave transient `.bak` artifacts.
* Add focused tests under `tests/shared/json-stream/**` or a caller-specific artifact test when changing byte-accounting, compression, or atomic replacement semantics.

## 8. Reader notes

- JSONL readers use buffer scanning (no readline) and adaptive `highWaterMark` sizing for large shards.
- Large zstd/gzip shards use streaming decompression; buffer decompression is reserved for small files.
- Sharded reads may run in parallel but must preserve shard order when concatenating rows.
- Offsets metadata records `version`, `format`, and `compression` for deterministic loader validation.
- Unsharded JSONL writers should pass `maxBytes` into `writeJsonLinesFile`/`writeJsonLinesFileAsync` so oversized rows fail fast with `ERR_JSON_TOO_LARGE`.
- JSONL readers support `validationMode: "trusted"` to skip required-key checks on hot paths.

