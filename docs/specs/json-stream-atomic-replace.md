# Spec: JSON Streaming Writers, Sharding-by-Compressed-Bytes, and Atomic Replace Hygiene (Phase 4.6 + 4.11)

Status: Draft (implementation-ready)

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

## 2. Current implementation (validated)

Primary module: `src/shared/json-stream.js`

Key functions:
* `createFflateGzipStream(options)` -- currently forwards only `level`
* `createJsonWriteStream(filePath, options)` -- returns `{ stream, done }`
* `writeJsonLinesSharded(records, outDir, options)` -- current sharding logic increments `bytesWritten` based on pre-compression line lengths
* `replaceFile(tmpPath, finalPath)` -- renames existing final to `.bak`, renames tmp to final, does not clean `.bak`

---

## 3. Forward gzip options correctly

### 3.1 Supported gzip options
We must decide what "gzipOptions" includes.

**Best-version choice:** support a safe subset that is:
* available in `fflate` gzip stream
* deterministic
* useful

Minimum required:
* `level` (0-9)

Optional (if supported by `fflate`):
* `mem` / `memLevel`
* `mtime` (should default to 0 for deterministic output if used)
* `filename` (discouraged)
* `comment` (discouraged)

If `fflate` does not support a requested option, we must:
* ignore it AND emit a warning (preferably once per run), OR
* throw a config error early

**Recommendation:** ignore unsupported options but warn once. This keeps configs portable while making the limitation visible.

### 3.2 Implementation details
Update:
* `createFflateGzipStream(options)` so it passes `options.gzipOptions` as-is (after normalization) into the fflate Gzip constructor (to the extent supported).
* Normalize:
  * if `options.gzipOptions.level` is undefined, default to 6 (current default)
  * clamp out-of-range levels and warn

---

## 4. Sharding based on post-compression bytes

### 4.1 What "post-compression bytes" means
For `compress = null`:
* post-compression bytes == bytes written to the shard file stream.

For `compress = 'gzip' | 'zstd'`:
* post-compression bytes == bytes emitted by the compression stream and passed to the file stream.

We will use a byte-counting transform on the data path *after* compression, *before* `fs.WriteStream`.

### 4.2 ByteCounter transform
Implement internal helper in `json-stream.js`:

```js
function createByteCounter() {
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      cb(null, chunk);
    }
  });
  return {
    counter,
    getBytes: () => bytes,
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

### 4.3 Expose bytesWritten from createJsonWriteStream
Change `createJsonWriteStream()` to return:
```ts
{
  stream: Writable;       // what callers write JSON to (gzip/zstd/counter)
  done: Promise<void>;    // resolves after fsWriteStream finishes
  getBytesWritten: () => number; // post-compression bytes produced so far
}
```

### 4.4 Shard-roll algorithm
Within `writeJsonLinesSharded`:

* Maintain `currentWriter` for current shard.
* After writing each record (including newline), call:
  * `await drainIfNeeded(stream)` (existing)
  * `const shardBytes = writer.getBytesWritten()`
* If `shardBytes >= maxBytes` and there are remaining records:
  * close shard (`stream.end(); await writer.done`)
  * promote temp file to final (atomic replace)
  * start next shard

**Shard boundary rule:** never split a record across shards. Shards roll only between records.

### 4.5 Metadata semantics
Update shard metadata produced by `writeJsonLinesSharded` to ensure:
* `bytes[i]` equals the on-disk bytes of shard file i after compression.

This will change:
* `src/index/build/artifacts.js` metadata (it currently stores pre-compression bytes).
Callers that treat "bytes" as a rough metric should continue to work; callers that use it for budget enforcement become correct.

### 4.6 Zstd specifics
`createZstdStream` is chunked; output is emitted incrementally. The byte counter will naturally track what is written.

---

## 5. Atomic replace and `.bak` hygiene

### 5.1 Problem definition
`replaceFile(tmpPath, finalPath)` currently:
1. renames existing final to `finalPath + '.bak'`
2. renames tmp to final
3. leaves `.bak` indefinitely

For JSONL shards and meta files, leaving `.bak`:
* wastes disk space
* creates confusion about "real" artifacts
* can cause future tooling to pick up wrong files if globbing is naive

### 5.2 Best-version choice: keep backups opt-in
Add options:
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

Implementation can reuse existing helper patterns from SQLite and HNSW subsystems (which already implement cleanup carefully).

---

## 6. Tests

### 6.1 Sharding uses compressed bytes
Create: `tests/json-stream-shard-maxbytes-compressed.js`

* Write a large set of repeated strings (highly compressible).
* Use `compress='gzip'`, `maxBytes` small (e.g., 2 KB).
* Assert:
  * multiple shards were produced
  * every shard file size on disk (`fs.statSync(path).size`) is **<= maxBytes + smallOverhead**
    * Overhead allowance should be small (gzip footer/header).  
    * If the implementation is strict and checks bytesWritten after each record, overhead should be minimal.

**Note:** if strict <= maxBytes is required, enforce a "finalize-then-check" approach, but that is typically not necessary and can complicate streaming. Prefer record-boundary checks and allow a small overhead margin, and document it.

### 6.2 gzip options forwarded
Create: `tests/json-stream-gzip-level-affects-size.js`

* Write a large repeated dataset.
* Run `writeJsonLines` twice with `gzipOptions.level=1` and `gzipOptions.level=9`.
* Assert size(level=9) <= size(level=1).

### 6.3 replaceFile cleanup
Create: `tests/replace-file-cleans-bak-by-default.js`

* Create `finalPath` with content A.
* Write tempPath with content B.
* Call `replaceFile(tempPath, finalPath)` (no keepBackup option).
* Assert:
  * finalPath contains content B
  * `finalPath + '.bak'` does not exist

Add keepBackup case:
* Call with `{ keepBackup: true }` and assert `.bak` exists and contains content A.

---

## 7. Files to modify

* `src/shared/json-stream.js`
  * forward gzip options
  * add ByteCounter
  * expose `getBytesWritten`
  * update sharding logic to use post-compression bytes
  * update `replaceFile` to accept keepBackup option and clean `.bak` by default

* `src/index/build/artifacts.js`
  * if any code relies on bytes being uncompressed, document or adjust; otherwise just accept the corrected metric

* Add tests under `tests/` as described above.

## 8. Reader notes

- JSONL readers use buffer scanning (no readline) and adaptive `highWaterMark` sizing for large shards.
- Large zstd/gzip shards use streaming decompression; buffer decompression is reserved for small files.
- Sharded reads may run in parallel but must preserve shard order when concatenating rows.
- Offsets metadata records `version`, `format`, and `compression` for deterministic loader validation.
- Unsharded JSONL writers should pass `maxBytes` into `writeJsonLinesFile`/`writeJsonLinesFileAsync` so oversized rows fail fast with `ERR_JSON_TOO_LARGE`.
- JSONL readers support `validationMode: "trusted"` to skip required-key checks on hot paths.

