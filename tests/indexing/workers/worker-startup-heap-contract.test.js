#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveDispatchRuntimeEnv } from '../../../bin/dispatch-runtime-env.js';
import { resolveWorkerHeapLaunchContract } from '../../../src/shared/workers/heap-contract.js';

const limits = { maxOldGenerationSizeMb: 128 };
assert.equal(resolveWorkerHeapLaunchContract(limits, { execArgv: [], nodeOptions: '' }).supported, true);
assert.equal(resolveWorkerHeapLaunchContract(limits, { execArgv: [], nodeOptions: '--max-old-space-size=512' }).fallback, 'inline');
assert.equal(resolveWorkerHeapLaunchContract(limits, { execArgv: ['--max_old_space_size=512'], nodeOptions: '' }).supported, false);
assert.equal(resolveWorkerHeapLaunchContract(limits, { execArgv: [], nodeOptions: '--max-old-space-size=64' }).enforcement, 'parent-startup-cap');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-worker-contract-'));
try {
  const probe = path.join(dir, 'probe.mjs');
  const poolUrl = pathToFileURL(path.resolve('src/index/build/workers/pool.js')).href;
  await fs.writeFile(probe, `import { Worker } from 'node:worker_threads';
import { createIndexerWorkerPools } from ${JSON.stringify(poolUrl)};
const observation = await new Promise((resolve, reject) => {
 const worker = new Worker('const {parentPort,resourceLimits}=require("node:worker_threads");parentPort.postMessage({resourceLimits,heapSizeLimitBytes:require("node:v8").getHeapStatistics().heap_size_limit})', {
  eval:true, execArgv:[], env:{...process.env,NODE_OPTIONS:''}, resourceLimits:{maxOldGenerationSizeMb:128}
 }); worker.once('message',resolve);worker.once('error',reject);
});
if (process.argv.includes('--clear-mutable-env')) delete process.env.NODE_OPTIONS;
const messages = [];
const pools = await createIndexerWorkerPools({config:{enabled:true,maxWorkers:1,heapTargetMb:128,heapMinMb:128,heapMaxMb:256,taskTimeoutMs:5000},log:(line)=>messages.push(line)});
let workerObservations = [];
if (pools.tokenizePool) {
 await pools.tokenizePool.runQuantize({vectors:[[0,1]],minVal:-1,maxVal:1,levels:255});
 workerObservations = pools.tokenizePool.stats().runtimeObservations;
}
const result = {observation,enabled:!!pools.tokenizePool,runtimeEvidence:pools.runtimeEvidence,workerObservations,messages};
await pools.destroy();
console.log(JSON.stringify(result));`);
  const run = (flags, nodeOptions, args = []) => {
    const child = spawnSync(process.execPath, [...flags, probe, ...args], { encoding: 'utf8', timeout: 8000, env: { ...process.env, NODE_OPTIONS: nodeOptions } });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout.trim().split('\n').at(-1));
  };
  const baseline = run([], '');
  assert.equal(baseline.enabled, true, 'normal unshaped launch must retain worker execution');
  assert.ok(baseline.workerObservations.length > 0);
  assert.equal(baseline.workerObservations[0].resourceLimitAcknowledged, true);
  const shapedEnv = await resolveDispatchRuntimeEnv({ root: dir, scriptPath: 'build_index.js', baseEnv: { ...process.env, NODE_OPTIONS: '', PAIROFCLEATS_MAX_OLD_SPACE_MB: '16384' } });
  assert.equal(shapedEnv.NODE_OPTIONS, '--max-old-space-size=16384');
  const controlledAccepted = run([], '--max-old-space-size=128', ['--clear-mutable-env']);
  assert.equal(controlledAccepted.enabled, true, 'controlled mutable-env boundary: captured parent cap fits the later worker budget');
  assert.equal(controlledAccepted.runtimeEvidence.tokenize.heapLaunchContract.enforcement, 'parent-startup-cap');
  for (const result of [run([], '--max-old-space-size=512'), run(['--max-old-space-size=512'], ''), run([], shapedEnv.NODE_OPTIONS)]) {
    assert.equal(result.enabled, false);
    assert.equal(result.runtimeEvidence.tokenize.heapLaunchContract.fallback, 'inline');
    assert.ok(result.observation.heapSizeLimitBytes > baseline.observation.heapSizeLimitBytes);
    assert.ok(result.messages.some((line) => line.includes('enforcement is unavailable')));
  }
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('worker startup heap contract test passed');
