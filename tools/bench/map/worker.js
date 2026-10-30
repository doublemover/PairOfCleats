import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { buildCodeMap } from '../../../src/map/build-map.js';
import { writeMapJsonStream } from '../../../src/map/build-map/io.js';
import { withMapJsonPublication } from '../../../src/map/build-map/publication.js';
import { writeChunk } from '../../../src/shared/json-stream/streams.js';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { readToolingCacheEntry } from '../../../src/index/tooling/cache-storage.js';
import { buildIndexSignature } from '../../../src/retrieval/index-cache.js';
import { isDirectExecution } from '../../../src/shared/direct-execution.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { describeMapWorkload, observeMapProcessMemory, MAP_BENCH_KIND, MAP_BENCH_MARKER, MAP_BENCH_INPUT, MAP_BENCH_MAX_BYTES } from './observation.js';
import { createMapGcObservation } from './gc-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

export const writeWholeMapJson = (filePath, model) => withMapJsonPublication(filePath,
  async stream => { await writeChunk(stream, JSON.stringify(model)); });
const writeStreaming = (filePath, model) => {
  const { nodes, edges, ...mapBase } = model;
  return writeMapJsonStream({ filePath, mapBase, nodes, edges });
};
const readPreparedModel = async (root, marker) => {
  const loaded = await readVerifiedContainedFile(root, path.join(root, MAP_BENCH_INPUT), {
    maxBytes: MAP_BENCH_MAX_BYTES, expectedBytes: marker.inputBytes, expectedHash: marker.inputHash
  });
  return JSON.parse(loaded.buffer.toString('utf8'));
};

export const runMapBenchWorker = async request => {
  if (request?.operation === 'serialize') {
    const { rootDir, arm } = request;
    if (!path.isAbsolute(rootDir) || !['baseline', 'streaming'].includes(arm)) throw new TypeError('Invalid map serialization worker request.');
    const marker = readToolingCacheEntry(path.join(rootDir, MAP_BENCH_MARKER), 8192).payload;
    const parentRoot = path.dirname(rootDir), parent = readToolingCacheEntry(path.join(parentRoot, MAP_BENCH_MARKER), 8192).payload;
    if (parentRoot === rootDir || marker.kind !== MAP_BENCH_KIND || parent.kind !== MAP_BENCH_KIND
      || marker.role !== 'writer-sample' || marker.arm !== arm || marker.owner !== parent.owner
      || typeof parent.owner !== 'string' || !/^[a-f0-9-]{36}$/u.test(parent.owner)
      || !Number.isSafeInteger(parent.inputBytes) || parent.inputBytes < 1 || parent.inputBytes > MAP_BENCH_MAX_BYTES) throw new Error('Map worker fixture/input ownership is unconfirmed.');
    const gc = createMapGcObservation();
    let failed = false, primary;
    try {
      gc.mark('input-admission:start');
      const inputAt = performance.now(), model = await readPreparedModel(parentRoot, parent), inputEnd = performance.now();
      const inputAdmissionMs = inputEnd - inputAt, workload = describeMapWorkload(model, parent.inputBytes);
      gc.mark('input-admission:end');
      const write = arm === 'baseline' ? writeWholeMapJson : writeStreaming;
      gc.mark('warmup:start');
      const before = process.memoryUsage(), warmupAt = performance.now();
      await write(path.join(rootDir, 'warmup.json'), model);
      const warmupEnd = performance.now(), warmupMs = warmupEnd - warmupAt;
      gc.mark('warmup:end'); gc.mark('measured:start');
      const measuredAt = performance.now(), outputPath = path.join(rootDir, 'measured.json');
      await write(outputPath, model);
      const measuredEnd = performance.now(), elapsedMs = measuredEnd - measuredAt, after = process.memoryUsage();
      const memory = observeMapProcessMemory({ before, after, through: 'measured-atomic-publication-completion;before-consumer-parity' });
      gc.mark('measured:end');
      const gcObservation = await gc.complete({ inputAdmission: [inputAt, inputEnd], warmup: [warmupAt, warmupEnd], measured: [measuredAt, measuredEnd] });
      const output = await readVerifiedContainedFile(rootDir, outputPath, { maxBytes: MAP_BENCH_MAX_BYTES });
      if (!isDeepStrictEqual(JSON.parse(output.buffer.toString('utf8')), model)) throw new Error('Map serialization changed parsed content.');
      return { schemaVersion: 2, operation: 'serialize', state: 'qualified-content-and-publication', arm, pid: process.pid,
        inputHash: parent.inputHash, inputAdmissionMs, warmupMs, elapsedMs, completedOperations: 1, warmupOperations: 1,
        publication: 'shared-map-atomic-stream-owner', outputBytes: output.buffer.byteLength, outputSha256: output.hash,
        consumerParity: 'parsed-content-identical', memory, gcObservation, workload };
    } catch (error) { failed = true; primary = error; throw error; }
    finally {
      try { gc.disconnect(); }
      catch (cleanup) { if (failed) throw addStorageFailureContext(primary, {}, cleanup, { secondaryPresent: true }); throw cleanup; }
    }
  }
  if (request?.operation === 'build') {
    const { repoRoot, indexDir, buildOptions } = request;
    if (!path.isAbsolute(repoRoot) || !path.isAbsolute(indexDir)) throw new TypeError('Absolute map build inputs required.');
    const source = await buildIndexSignature(indexDir), before = process.memoryUsage(), started = performance.now();
    const model = await buildCodeMap({ repoRoot, indexDir, options: buildOptions });
    const elapsedMs = performance.now() - started, after = process.memoryUsage();
    const memory = observeMapProcessMemory({ before, after, through: 'final-map-model-completion' });
    if (stableStringify(await buildIndexSignature(indexDir)) !== stableStringify(source)) throw new Error('Map build source changed during measurement.');
    if (model.buildMetrics?.memoryObservation?.includesFinalModel !== true) throw new Error('Map build omitted its final memory observation.');
    const buildMetrics = { ...model.buildMetrics }; delete buildMetrics.peak;
    return { schemaVersion: 2, operation: 'build', state: 'observed-build', pid: process.pid, source, elapsedMs,
      completedOperations: 1, workload: { ...describeMapWorkload(model), task: 'materialize-code-map-from-selected-index' }, buildMetrics, memory };
  }
  throw new TypeError('Unknown internal map benchmark operation.');
};

if (isDirectExecution(import.meta.url)) {
  try {
    if (!process.argv[2] || Buffer.byteLength(process.argv[2]) > 16384) throw new TypeError('Bounded map worker request required.');
    console.log(JSON.stringify(await runMapBenchWorker(JSON.parse(process.argv[2]))));
  } catch (error) { console.error(error?.stack || error); process.exitCode = 1; }
}
