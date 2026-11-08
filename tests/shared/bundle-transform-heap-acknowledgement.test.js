import assert from 'node:assert/strict';
import { runNode } from '../helpers/run-node.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();
const moduleUrl = new URL('../../src/shared/workers/heap-contract.js', import.meta.url).href;
const probe = `
const { Worker } = require('node:worker_threads');
const limits = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: Number(process.argv[1]) };
(async () => {
  const contract = await import(${JSON.stringify(moduleUrl)});
  const worker = new Worker(${JSON.stringify(`
    import(${JSON.stringify(moduleUrl)}).then(module => {
      require('node:worker_threads').parentPort.postMessage(module.observeWorkerHeap());
    });
  `)}, { eval: true, resourceLimits: limits });
  try {
    const observed = await new Promise((resolve, reject) => {
      worker.once('message', resolve); worker.once('error', reject);
      worker.once('exit', code => reject(new Error('Worker exited before observation: ' + code)));
    });
    console.log(JSON.stringify({ launch: contract.resolveWorkerHeapLaunchContract(limits), observed }));
  } finally { await worker.terminate(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
`;
const run = (youngMb, flags = [], nodeOptions = '') => {
  const child = runNode([...flags, '-e', probe, String(youngMb)], 'actual worker heap observation',
    process.cwd(), { ...process.env, NODE_OPTIONS: nodeOptions }, { stdio: 'pipe', timeoutMs: 5000, allowFailure: true });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
};
for (const [youngMb, totalMb] of [[32, 304], [24, 280], [48, 304]]) {
  const { launch, observed } = run(youngMb);
  assert.equal(launch.supported, true);
  assert.equal(observed.resourceLimitAcknowledged, true, JSON.stringify(observed));
  assert.equal(observed.heapSizeLimitBytes, totalMb * 1024 * 1024);
  assert.equal(observed.heapSizeLimitCeilingBytes, totalMb * 1024 * 1024);
}
for (const [flags, nodeOptions] of [
  [['--max-old-space-size=512'], ''], [[], '--max-old-space-size=512'],
  [['--max-semi-space-size=64'], ''], [[], '--max-semi-space-size=64']
]) {
  const { launch, observed } = run(32, flags, nodeOptions);
  assert.equal(launch.supported, false, 'startup overrides cannot masquerade as bounded worker settings');
  assert.equal(observed.resourceLimitAcknowledged, false, 'an oversized actual heap is never acknowledged');
}
for (const flags of [['--max-old-space-size=128'], ['--max-semi-space-size=8']]) {
  const { launch, observed } = run(32, flags);
  assert.equal(launch.supported, true, 'a stricter startup cap remains admissible');
  assert.equal(observed.resourceLimitAcknowledged, true);
}
console.log('actual worker heap rounding and startup override controls passed');
