#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const { createCli } = await import('../../../src/shared/cli.js');
const { spawnSubprocess } = await import('../../../src/shared/subprocess/runner.js');
const { formatStats, summarizeDurations, writeJsonWithDir } = await import('../micro/utils.js');
const { isDirectExecution } = await import('../../../src/shared/direct-execution.js');
const { stableStringify } = await import('../../../src/shared/stable-json.js');
const { addStorageFailureContext } = await import('../../../src/shared/storage/operation-error.js');
const { observeStorageResource } = await import('../../../src/shared/storage/failure-observation.js');
const { assertToolingCachePath, ensureToolingCacheDir, readToolingCacheEntry } = await import('../../../src/index/tooling/cache-storage.js');
const { resolveDevelopmentArtifactPath } = await import('../../shared/dev-artifacts.js');
const { admitVfsColdStartWork, buildVfsColdStartPlan, runVfsColdStartSample } = await import('./cold-start-sample.js');

const markerName = 'vfs-benchmark-owner.json';
const markerKind = 'vfs-cold-cache-benchmark-v2';
const readMarker = root => {
  assertToolingCachePath(root);
  const value = readToolingCacheEntry(path.join(root, markerName), 8192).payload;
  if (value?.kind !== markerKind || typeof value.owner !== 'string' || !/^[a-f0-9-]{36}$/u.test(value.owner)) {
    throw new Error('Internal VFS benchmark modes require an owned fixture root.');
  }
  return value;
};
const writeMarker = async (root, value) => {
  ensureToolingCacheDir(root);
  await fs.writeFile(path.join(root, markerName), JSON.stringify({ kind: markerKind, ...value }) + '\n', { flag: 'wx' });
};
const runSubprocess = async ({ mode, rootDir, docs, docBytes }) => {
  const result = await spawnSubprocess(process.execPath, [fileURLToPath(import.meta.url), '--mode', mode, '--root', rootDir,
    '--docs', String(docs), '--doc-bytes', String(docBytes), '--samples', '1', '--json'], {
    timeoutMs: 30000, maxOutputBytes: 256 * 1024, outputEncoding: 'utf8', outputMode: 'string',
    captureStdout: true, captureStderr: true, rejectOnNonZeroExit: true, killTree: true
  });
  if (result.outputCapture?.stdout?.truncated || result.outputCapture?.stderr?.truncated
    || result.outputCapture?.stdout?.encodingLoss || result.outputCapture?.stderr?.encodingLoss || result.stderr?.trim()) {
    throw Object.assign(new Error('VFS benchmark child emitted unexpected/truncated diagnostics.'), { result });
  }
  let observed;
  try { observed = JSON.parse(result.stdout); }
  catch (error) { throw addStorageFailureContext(error, { workerResult: result, mode }); }
  return { ...observed, childWallMs: result.durationMs };
};
const summarize = samples => {
  const qualified = samples.every(value => value.state === 'qualified-phase');
  const durations = samples.map(value => value.phases.totalMs), totalMs = durations.reduce((sum, value) => sum + value, 0);
  const completedDocuments = samples.reduce((sum, value) => sum + value.counts.documents, 0);
  const observedStats = summarizeDurations(durations);
  return { state: qualified ? 'qualified-phase' : 'unqualified-phase', completedSamples: samples.length,
    completedDocuments, totalMs, stats: qualified ? observedStats : null, observedStats,
    docsPerSec: qualified && totalMs > 0 ? completedDocuments / (totalMs / 1000) : null,
    phases: Object.fromEntries(['cacheLoadMs', 'warmupMs', 'documentAccessMs', 'flushMs'].map(key => [key,
      { stats: summarizeDurations(samples.map(value => value.phases[key])), rawSamplesMs: samples.map(value => value.phases[key]) }])), samples };
};

export const runVfsColdStartBench = async input => {
  const { docs, docBytes, samples } = admitVfsColdStartWork(input);
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const tempBase = resolveDevelopmentArtifactPath(repoRoot, 'bench-cache', 'vfs-cold');
  ensureToolingCacheDir(tempBase);
  const taskRoot = await fs.mkdtemp(path.join(tempBase, 'run-')), owner = randomUUID();
  let primary, failed = false, result;
  try {
    await writeMarker(taskRoot, { owner, docs, docBytes });
    const observations = { cold: [], warm: [], hot: [] }, order = [];
    let workloadIdentity = null, outputIdentity = null;
    for (let index = 0; index < samples; index++) {
      const rootDir = path.join(taskRoot, `sample-${index + 1}`);
      await writeMarker(rootDir, { owner, docs, docBytes, sample: index + 1 });
      const modes = ['cold', ...(index % 2 ? ['hot', 'warm'] : ['warm', 'hot'])];
      for (const mode of modes) {
        const sample = await runSubprocess({ mode, rootDir, docs, docBytes });
        if (sample.mode !== mode || sample.counts?.documents !== docs || sample.consumerParity?.state !== 'byte-identical'
          || !['qualified-phase', 'unqualified-phase'].includes(sample.state)) throw new Error('VFS child sample has inconsistent phase or content evidence.');
        const workload = stableStringify(sample.workload), output = sample.consumerParity.sha256;
        if (workloadIdentity !== null && workloadIdentity !== workload || outputIdentity !== null && outputIdentity !== output) {
          throw new Error('VFS benchmark samples changed their input or consumer content.');
        }
        workloadIdentity = workload; outputIdentity = output; observations[mode].push(sample);
        order.push({ sample: index + 1, mode });
      }
    }
    result = { schemaVersion: 2, kind: 'vfs-cache-phase-benchmark', generatedAt: new Date().toISOString(), docs, docBytes, samples,
      state: Object.values(observations).every(values => values.every(value => value.state === 'qualified-phase')) ? 'qualified-phases' : 'unqualified-phases',
      fixtureRoot: taskRoot, fixturePolicy: 'fresh-exclusively-owned-root-per-cold-repetition', fixtureCleanup: 'pending',
      processPolicy: 'fresh-serial-node-child-per-scenario-sample', osCachePolicy: 'uncontrolled-filesystem-cache',
      orderPolicy: 'cold-prime-each-fixture;alternate-warm-hot-order', order,
      runtime: { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch },
      workload: observations.cold[0].workload, cold: summarize(observations.cold), warm: summarize(observations.warm), hot: summarize(observations.hot) };
  } catch (error) { failed = true; primary = error; }
  try {
    if (failed) observeStorageResource(primary, { phase: 'vfs-benchmark-before-fixture-cleanup' }).requireSettled();
    if (path.dirname(taskRoot) !== tempBase || readMarker(taskRoot).owner !== owner) throw new Error('VFS fixture cleanup ownership is unconfirmed.');
    assertToolingCachePath(taskRoot); await fs.rm(taskRoot, { recursive: true, force: true });
    if (result) result.fixtureCleanup = 'completed';
  } catch (error) {
    if (failed) throw addStorageFailureContext(primary, { fixtureRoot: taskRoot, phase: 'vfs-benchmark-fixture-cleanup' }, error, { secondaryPresent: true });
    throw Object.assign(error, { fixtureRoot: taskRoot });
  }
  if (failed) throw primary;
  return result;
};

export const runVfsColdStartBenchCli = async (rawArgs = process.argv.slice(2)) => {
  const argv = createCli({ scriptName: 'cold-start-cache', argv: ['node', 'cold-start-cache', ...rawArgs], options: {
    mode: { type: 'string', describe: 'Internal: cold|warm|hot single scenario' },
    docs: { type: 'number', default: 2000, describe: 'Document count' },
    docBytes: { type: 'number', default: 256, describe: 'UTF-8 bytes per document' },
    samples: { type: 'number', default: 3, describe: 'Independent repetitions per scenario' },
    root: { type: 'string', describe: 'Internal: owned scenario root' },
    json: { type: 'boolean', default: false }, out: { type: 'string', describe: 'Write JSON results to a file' }
  } }).parse();
  const work = admitVfsColdStartWork({ docs: argv.docs, docBytes: argv.docBytes, samples: argv.samples });
  let result;
  if (argv.mode) {
    if (!['cold', 'warm', 'hot'].includes(argv.mode) || !argv.root || work.samples !== 1) throw new TypeError('Internal VFS scenario requires its owned root and exactly one sample.');
    const rootDir = path.resolve(argv.root), marker = readMarker(rootDir);
    if (marker.docs !== work.docs || marker.docBytes !== work.docBytes) throw new Error('VFS scenario request differs from its owned fixture.');
    const started = performance.now(), plan = await buildVfsColdStartPlan(work), documentPlanMs = performance.now() - started;
    result = { ...await runVfsColdStartSample({ mode: argv.mode, rootDir, plan }), documentPlanMs };
  } else result = await runVfsColdStartBench(work);
  if (argv.out) writeJsonWithDir(argv.out, result);
  if (argv.json) console.log(JSON.stringify(result, null, 2));
  else if (argv.mode) console.error(`[cold-start-cache:${argv.mode}] ${result.state}; ${result.counts.documents} documents`);
  else {
    console.error(`[cold-start-cache] ${work.docs} docs; ${work.docBytes} UTF-8 bytes/doc; ${work.samples} independent samples`);
    for (const mode of ['cold', 'warm', 'hot']) console.error(`- ${mode}: ${result[mode].state}; ${result[mode].stats ? formatStats(result[mode].stats) : 'unqualified'}`);
  }
  return result;
};

if (isDirectExecution(import.meta.url)) runVfsColdStartBenchCli().catch(error => {
  console.error(error?.stack || error);
  if (error?.fixtureRoot) console.error(`[cold-start-cache] retained fixture: ${error.fixtureRoot}`);
  process.exitCode = 1;
});
