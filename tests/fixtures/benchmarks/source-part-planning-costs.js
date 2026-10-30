import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { resolveCanonicalSourceParts, resolveRequiredSources } from '../../../src/shared/artifact-io/loaders/core-source-resolution.js';
import { loadJsonArrayArtifactRows, loadFileMetaRows } from '../../../src/shared/artifact-io/loaders.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { observeHeapAllocations } from '../../helpers/heap-sampling.js';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const collect = async iterable => { const rows = []; for await (const row of iterable) rows.push(row); return rows; };

// Valid-input algorithm comparator, not a historical checkout or an authority
// fallback: canonical relative paths have already been selected independently.
const sequentialCanonicalPlan = ({ dir, manifest, name, canonicalPaths, paths }) => canonicalPaths.map((canonicalPath, index) => {
  const relative = path.relative(dir, canonicalPath).replaceAll('\\', '/');
  const entry = manifest.pieces.find(piece => piece.name === name && piece.path === relative);
  if (!entry) throw new Error('Sequential control requires the exact canonical entry.');
  return { canonicalPath, sourcePath: paths[index], expectedCount: entry.count ?? null };
});

const qualifyConsumers = async destination => {
  const root = path.join(destination, 'consumer-controls'); await fs.mkdir(root);
  const originalOpen = fs.open, handles = new Set(), dataPaths = new Set();
  const originalSyncOpen = fsSync.openSync, originalSyncRead = fsSync.readSync, originalSyncClose = fsSync.closeSync, syncData = new Set();
  let syncDataOpens = 0, syncDataCloses = 0;
  let opens = 0, closes = 0, payloadReadBytes = 0, abortDuringRead = null;
  fsSync.openSync = function(target, ...args) {
    const fd = Reflect.apply(originalSyncOpen, fsSync, [target, ...args]);
    if (typeof target === 'string' && dataPaths.has(path.resolve(target))) { syncData.add(fd); syncDataOpens++; }
    return fd;
  };
  fsSync.readSync = function(fd, ...args) {
    const bytes = Reflect.apply(originalSyncRead, fsSync, [fd, ...args]); if (syncData.has(fd)) payloadReadBytes += bytes; return bytes;
  };
  fsSync.closeSync = function(fd, ...args) {
    const result = Reflect.apply(originalSyncClose, fsSync, [fd, ...args]);
    if (syncData.delete(fd)) syncDataCloses++; return result;
  };
  fs.open = async function(target, ...args) {
    const handle = await Reflect.apply(originalOpen, fs, [target, ...args]); handles.add(handle); opens++;
    const close = handle.close, read = handle.read;
    handle.close = async function(...input) {
      const result = await Reflect.apply(close, handle, input);
      if (handles.delete(handle)) closes++; return result;
    };
    handle.read = async function(...input) {
      const result = await Reflect.apply(read, handle, input);
      if (dataPaths.has(path.resolve(target))) payloadReadBytes += result.bytesRead;
      abortDuringRead?.abort(); return result;
    };
    return handle;
  };
  const observations = [];
  try {
    for (const family of ['sample', 'file_meta']) {
      const dir = path.join(root, family); await fs.mkdir(dir);
      const expected = [], parts = [], offsets = [], pieces = [], tables = [];
      for (const [part, count] of [2, 3].entries()) {
        const filename = `rows.bak.part-${String(part).padStart(6, '0')}.jsonl`, sidecar = filename + '.offsets.bin';
        const rows = Array.from({ length: count }, (_, row) => ({ id: part * 10 + row, file: `src/${part}-${row}.js` }));
        const lines = rows.map(row => JSON.stringify(row) + '\n'), table = Buffer.alloc(count * 8);
        let bytes = 0; lines.forEach((line, index) => { table.writeBigUInt64LE(BigInt(bytes), index * 8); bytes += Buffer.byteLength(line); });
        const physical = path.join(dir, filename + (part === 0 ? '.bak' : ''));
        const offsetPath = path.join(dir, sidecar + (part === 0 ? '.bak' : ''));
        await fs.writeFile(physical, lines.join('')); await fs.writeFile(offsetPath, table); dataPaths.add(physical);
        expected.push(...rows); parts.push(filename); offsets.push(sidecar); tables.push({ offsetPath, table });
        pieces.push({ name: family, path: filename, format: 'jsonl', count });
      }
      await fs.writeFile(path.join(dir, 'rows.meta.json'), JSON.stringify({ format: 'jsonl-sharded', parts, offsets }));
      pieces.push({ name: family + '_meta', path: 'rows.meta.json', format: 'json' });
      const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces };
      const selected = resolveRequiredSources({ dir, manifest, name: family, strict: true, maxBytes: 65536 });
      assert.deepEqual(selected.sourceParts.map(row => row.expectedCount), [2, 3]);
      assert.deepEqual(selected.paths, parts.map((part, index) => path.join(dir, part + (index === 0 ? '.bak' : ''))));
      const load = signal => family === 'sample' ? loadJsonArrayArtifactRows(dir, family, { manifest, strict: true, signal })
        : loadFileMetaRows(dir, { manifest, strict: true, signal });
      assert.deepEqual(await collect(load()), expected);
      const failures = [];
      for (const [index, { offsetPath, table }] of tables.entries()) {
        await fs.writeFile(offsetPath, table.subarray(0, 8)); payloadReadBytes = 0;
        let yielded = 0;
        await assert.rejects(async () => { for await (const row of load()) { assert.ok(row); yielded++; } }, { code: 'ERR_OFFSETS_INVALID' });
        assert.equal(yielded, index === 0 ? 0 : 2);
        if (index === 0) assert.equal(payloadReadBytes, 0, 'canonical count refusal adds no payload scan');
        failures.push({ part: index, yielded, payloadReadBytes }); await fs.writeFile(offsetPath, table);
      }
      const cancelled = new AbortController(); cancelled.abort();
      await assert.rejects(collect(load(cancelled.signal)), { name: 'AbortError' });
      abortDuringRead = new AbortController();
      await assert.rejects(collect(load(abortDuringRead.signal)), { name: 'AbortError' }); abortDuringRead = null;
      assert.equal(handles.size, 0); assert.equal(opens, closes);
      assert.deepEqual(await collect(load()), expected, 'cancellation cannot authorize a path-only success');
      observations.push({ family, counts: [2, 3], failures, preAbort: 'rejected', midReadAbort: 'rejected',
        asyncDescriptorsOpened: opens, originalAsyncClosesConfirmed: closes,
        syncPayloadDescriptorsOpened: syncDataOpens, originalSyncPayloadClosesConfirmed: syncDataCloses,
        descriptorScope: 'captured original asynchronous loader opens plus synchronous authored-payload opens; synchronous metadata descriptors not counted' });
    }
  } finally {
    abortDuringRead = null; fs.open = originalOpen;
    fsSync.openSync = originalSyncOpen; fsSync.readSync = originalSyncRead; fsSync.closeSync = originalSyncClose;
  }
  assert.equal(handles.size, 0); assert.equal(opens, closes); assert.equal(syncData.size, 0); assert.equal(syncDataOpens, syncDataCloses);
  return observations;
};

export const runScenario = async ({ destination, shards }) => {
  assert.ok(path.isAbsolute(destination)); assert.ok([1, 10, 1000].includes(shards));
  const dir = path.join(destination, 'descriptor-root'), name = 'sample', canonicalPaths = [], paths = [], expected = [], entries = [];
  const authored = [];
  for (let index = 0; index < shards; index++) {
    const relative = `rows.bak.part-${String(index).padStart(6, '0')}.jsonl`, physical = relative + (index % 3 === 0 ? '.bak' : '');
    const count = 2 + index * 7 % 11, canonicalPath = path.join(dir, relative), sourcePath = path.join(dir, physical);
    canonicalPaths.push(canonicalPath); paths.push(sourcePath); expected.push({ canonicalPath, sourcePath, expectedCount: count });
    authored.push({ relative, physical, count }); entries.push({ name, path: relative, format: 'jsonl', count });
  }
  // Reverse manifest order and interleave unrelated pieces. Source ordering and
  // unequal counts are authored independently, never inferred from a result.
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: entries.toReversed().flatMap((entry, index) =>
    [{ name: 'unrelated', path: `other-${index}.json`, format: 'json', count: 0 }, entry]) };
  const input = { dir, manifest, name, canonicalPaths, paths, strict: true };
  const encoded = JSON.stringify({ shards, authored, manifest }); await fs.writeFile(path.join(destination, 'authored-plan-input.json'), encoded + '\n', { flag: 'wx' });
  const operations = { indexed: () => resolveCanonicalSourceParts(input), sequential: () => sequentialCanonicalPlan(input) };
  for (const operation of Object.values(operations)) assert.deepEqual(operation(), expected);
  assert.throws(() => resolveCanonicalSourceParts({ ...input, manifest: { ...manifest, pieces: [...manifest.pieces, entries[0]] } }), { code: 'ERR_MANIFEST_INVALID' });
  assert.throws(() => resolveCanonicalSourceParts({ ...input, canonicalPaths: [path.join(dir, 'missing.jsonl')] }), { code: 'ERR_MANIFEST_INCOMPLETE' });
  const legacy = structuredClone(manifest); delete legacy.pieces.find(piece => piece.name === name).count;
  assert.ok(resolveCanonicalSourceParts({ ...input, manifest: legacy }).some(part => part.expectedCount === null));
  assert.ok(resolveCanonicalSourceParts({ ...input, strict: false }).every(part => part.expectedCount === null));
  const workCounters = [];
  for (const arm of Object.keys(operations)) {
    const observed = { name: 0, path: 0, count: 0 };
    const pieces = manifest.pieces.map(piece => new Proxy(piece, { get(target, key, receiver) {
      if (Object.hasOwn(observed, key)) observed[key]++; return Reflect.get(target, key, receiver);
    } }));
    const request = { ...input, manifest: { ...manifest, pieces } };
    const result = arm === 'indexed' ? resolveCanonicalSourceParts(request) : sequentialCanonicalPlan(request);
    assert.deepEqual(result, expected);
    assert.equal(observed.count, shards);
    assert.equal(observed.name, arm === 'indexed' ? shards * 2 : shards * (shards + 1));
    assert.equal(observed.path, arm === 'indexed' ? shards : shards * (shards + 1) / 2);
    workCounters.push({ arm, propertyReads: observed, scope: 'separate actual manifest-entry property accesses;not instrumented clean latency or native Map internals' });
  }
  const clean = [], iterationsPerSample = 4;
  for (let sample = 0; sample < 16; sample++) for (const arm of sample % 2 ? ['sequential', 'indexed'] : ['indexed', 'sequential']) {
    const cpu = process.threadCpuUsage(), started = performance.now(); let result;
    for (let iteration = 0; iteration < iterationsPerSample; iteration++) result = operations[arm]();
    const wallMs = performance.now() - started, cpuMicros = process.threadCpuUsage(cpu);
    assert.deepEqual(result, expected); clean.push({ sample, arm, iterations: iterationsPerSample, wallMs, cpuMicros });
  }
  const memory = [];
  for (const arm of ['indexed', 'sequential']) {
    const before = process.memoryUsage(); let retained = operations[arm]();
    const whileOutputHeld = process.memoryUsage(), outputJsonBytes = Buffer.byteLength(JSON.stringify(retained));
    assert.deepEqual(retained, expected); const outputRows = retained.length; retained = null;
    await new Promise(resolve => setImmediate(resolve)); const afterDroppingOutput = process.memoryUsage();
    const allocation = await observeHeapAllocations({ destination, name: arm + '-planning', operation: operations[arm], iterations: 16 });
    memory.push({ arm, before, whileOutputHeld, afterDroppingOutput, outputRows, outputJsonBytes, allocation,
      scope: 'one materialized output plan;endpoint memory without forced GC;serialized bytes are logical output size, not exact retained/private-index heap' });
  }
  const controls = await qualifyConsumers(destination), sourceOwners = [];
  for (const file of ['tests/fixtures/benchmarks/source-part-planning-costs.js', 'tests/perf/qualification/source-part-planning.js',
    'src/shared/artifact-io/loaders/core-source-resolution.js', 'src/shared/artifact-io/loaders/core-row-stream.js',
    'src/shared/artifact-io/loaders/core-file-meta.js', 'src/shared/artifact-io/offsets.js', 'tests/helpers/heap-sampling.js']) {
    sourceOwners.push({ path: file, sha256: hash(await fs.readFile(file)) });
  }
  return { issue: 1572, shards, manifestPieces: manifest.pieces.length, inputSha256: hash(encoded + '\n'), sourceOwners, clean, workCounters, memory, controls,
    ordering: authored, outputJsonSha256: hash(JSON.stringify(expected)), processLifetimeMaxRssKiB: process.resourceUsage().maxRSS,
    scope: 'actual canonical descriptor planner versus valid normalized-input sequential canonical lookup control;no payload IO in clean samples',
    limits: 'not a historical same-source speedup;physical recovery/count/cancellation controls are separately tiny;sampled JS allocations and endpoint memory do not establish exact retained/private-Map/native peak bytes' };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await requireBootstrap(); applyTestEnv();
  const [count, destination] = process.argv.slice(2); assert.ok(destination && path.isAbsolute(destination)); await fs.mkdir(destination);
  const started = performance.now(), report = await runScenario({ destination, shards: Number(count) });
  await atomicWriteJson(path.join(destination, 'receipt.json'), { schemaVersion: 1, status: 'passed', historicalAuthorWorkspace: true,
    pid: process.pid, node: process.version, elapsedMs: performance.now() - started, report }, { createOnly: true });
}
