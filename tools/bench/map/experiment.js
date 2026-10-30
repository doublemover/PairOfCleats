import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { writeMapJsonStream } from '../../../src/map/build-map/io.js';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { assertToolingCachePath, ensureToolingCacheDir, readToolingCacheEntry } from '../../../src/index/tooling/cache-storage.js';
import { summarizeDurations } from '../micro/utils.js';
import { resolveDevelopmentArtifactPath } from '../../shared/dev-artifacts.js';
import { resolveRuns } from './shared.js';
import { writeWholeMapJson } from './worker.js';
import { describeMapWorkload, MAP_BENCH_KIND, MAP_BENCH_MARKER, MAP_BENCH_INPUT, MAP_BENCH_MAX_BYTES } from './observation.js';

export const runMapWorker = async request => {
  const encoded = JSON.stringify(request);
  if (Buffer.byteLength(encoded) > 16384) throw new RangeError('Map worker request exceeds its admission bound.');
  const result = await spawnSubprocess(process.execPath, [fileURLToPath(new URL('./worker.js', import.meta.url)), encoded], {
    timeoutMs: 30000, maxOutputBytes: 256 * 1024, outputEncoding: 'utf8', outputMode: 'string',
    captureStdout: true, captureStderr: true, rejectOnNonZeroExit: true, killTree: true
  });
  if (result.outputCapture?.stdout?.truncated || result.outputCapture?.stderr?.truncated
    || result.outputCapture?.stdout?.encodingLoss || result.outputCapture?.stderr?.encodingLoss || result.stderr?.trim()) {
    throw Object.assign(new Error('Map benchmark worker emitted unexpected/truncated diagnostics.'), { result });
  }
  let sample;
  try { sample = JSON.parse(result.stdout); }
  catch (error) { throw addStorageFailureContext(error, { workerResult: result }); }
  if (sample.pid !== result.pid || sample.pid === process.pid || sample.completedOperations !== 1) throw new Error('Map worker lacks fresh-process completed-work identity.');
  return { ...sample, childWallMs: result.durationMs };
};

const summarize = samples => ({ completedOperations: samples.length,
  timings: summarizeDurations(samples.map(value => value.elapsedMs)),
  rawSampleDurationsMs: samples.map(value => value.elapsedMs), samples });

const prepareMapInput = async (root, model) => {
  const started = performance.now(), { nodes, edges, ...mapBase } = model;
  await writeMapJsonStream({ filePath: path.join(root, MAP_BENCH_INPUT), mapBase, nodes, edges });
  await writeWholeMapJson(path.join(root, 'baseline-preflight.json'), model);
  const input = await readVerifiedContainedFile(root, path.join(root, MAP_BENCH_INPUT), { maxBytes: MAP_BENCH_MAX_BYTES });
  const baseline = await readVerifiedContainedFile(root, path.join(root, 'baseline-preflight.json'), { maxBytes: MAP_BENCH_MAX_BYTES });
  const normalized = JSON.parse(input.buffer.toString('utf8'));
  if (!isDeepStrictEqual(JSON.parse(baseline.buffer.toString('utf8')), normalized)) throw new Error('Map writer preflight differs before timing.');
  return { workload: describeMapWorkload(normalized, input.buffer.byteLength), inputHash: input.hash,
    inputBytes: input.buffer.byteLength, preparationMs: performance.now() - started };
};

export const runMapSerializationExperiment = async ({ model, outputParent = null, runs, source = null }, { firstRun = 0 } = {}) => {
  runs = resolveRuns(runs);
  if (!Number.isSafeInteger(firstRun) || firstRun < 0 || !Number.isSafeInteger(firstRun + runs)) throw new RangeError('Invalid private map repetition coordinate.');
  const workloadBeforeSerialization = describeMapWorkload(model);
  const base = outputParent ? path.resolve(outputParent) : resolveDevelopmentArtifactPath(
    fileURLToPath(new URL('../../../', import.meta.url)), 'bench-cache', 'map');
  ensureToolingCacheDir(base);
  const root = await fs.mkdtemp(path.join(base, 'm-')), owner = randomUUID();
  let primary, failed = false, report;
  try {
    await fs.writeFile(path.join(root, MAP_BENCH_MARKER), JSON.stringify({ kind: MAP_BENCH_KIND, owner }), { flag: 'wx' });
    const { workload, preparationMs, inputHash, inputBytes } = await prepareMapInput(root, model);
    const marker = { kind: MAP_BENCH_KIND, owner, inputHash, inputBytes };
    await fs.writeFile(path.join(root, MAP_BENCH_MARKER), JSON.stringify(marker));
    const samples = { baseline: [], streaming: [] }, order = [];
    for (let index = 0; index < runs; index++) {
      const run = firstRun + index;
      for (const arm of run % 2 ? ['streaming', 'baseline'] : ['baseline', 'streaming']) {
        const rootDir = path.join(root, `s${run + 1}-${arm}`); ensureToolingCacheDir(rootDir);
        await fs.writeFile(path.join(rootDir, MAP_BENCH_MARKER), JSON.stringify({ kind: MAP_BENCH_KIND, owner, role: 'writer-sample', arm }), { flag: 'wx' });
        const sample = await runMapWorker({ operation: 'serialize', rootDir, arm });
        if (sample.state !== 'qualified-content-and-publication' || sample.arm !== arm || sample.inputHash !== inputHash
          || sample.consumerParity !== 'parsed-content-identical' || sample.publication !== 'shared-map-atomic-stream-owner'
          || stableStringify(sample.workload) !== stableStringify(workload)) throw new Error('Map sample changed admitted workload/publication.');
        samples[arm].push(sample); order.push({ run: run + 1, arm });
      }
    }
    report = { schemaVersion: 2, kind: 'map-serialization-benchmark', generatedAt: new Date().toISOString(),
      scope: 'streaming-serialization-of-an-already-materialized-map', source, runs, firstRun, workload, workloadBeforeSerialization,
      inputIdentity: { algorithm: 'sha256', hash: inputHash, bytes: inputBytes }, preparationMs,
      preflight: { state: 'parsed-content-identical', publication: 'shared-map-atomic-stream-owner' },
      processPolicy: 'fresh-serial-node-child-per-arm-per-sample', orderPolicy: 'alternating-arms', osCachePolicy: 'uncontrolled-filesystem-cache',
      gcPolicy: 'no-explicit-GC-in-benchmark', order, baseline: summarize(samples.baseline), streaming: summarize(samples.streaming),
      memoryObservation: { heap: 'boundary-samples-only', rss: 'fresh-child-lifetime-through-publication',
        completeRssCoverage: [...samples.baseline, ...samples.streaming].every(sample => sample.memory.processLifetimeRss.state === 'observed') },
      fixtureRoot: root, fixtureCleanup: 'pending', runtime: { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch } };
  } catch (error) { failed = true; primary = error; }
  try {
    if (failed) observeStorageResource(primary, { phase: 'map-benchmark-before-fixture-cleanup' }).requireSettled();
    if (path.dirname(root) !== base || readToolingCacheEntry(path.join(root, MAP_BENCH_MARKER), 8192).payload.owner !== owner) throw new Error('Map fixture cleanup ownership is unconfirmed.');
    assertToolingCachePath(root); await fs.rm(root, { recursive: true, force: true });
    if (report) report.fixtureCleanup = 'completed';
  } catch (error) {
    if (failed) throw addStorageFailureContext(primary, { fixtureRoot: root, phase: 'map-benchmark-fixture-cleanup' }, error, { secondaryPresent: true });
    throw Object.assign(error, { fixtureRoot: root });
  }
  if (failed) throw primary;
  return report;
};

export const runMapMemoryExperiment = async ({ repoRoot, indexDir, buildOptions, runs }) => {
  runs = resolveRuns(runs);
  const results = []; let identity = null;
  for (let index = 0; index < runs; index++) {
    const sample = await runMapWorker({ operation: 'build', repoRoot, indexDir, buildOptions });
    const current = stableStringify({ source: sample.source, workload: sample.workload });
    if (sample.state !== 'observed-build' || identity !== null && current !== identity) throw new Error('Map build samples changed selected source or output.');
    identity = current; results.push({ run: index + 1, ...sample });
  }
  return { schemaVersion: 2, kind: 'map-build-memory-benchmark', generatedAt: new Date().toISOString(), repoRoot, indexDir, buildOptions,
    runs, completedOperations: results.length, processPolicy: 'fresh-serial-node-child-per-build', osCachePolicy: 'uncontrolled-filesystem-cache',
    runtime: { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch }, results };
};
