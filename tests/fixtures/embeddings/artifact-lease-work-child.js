import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs/promises');
const path = (await import('node:path')).default;
const { createHash } = await import('node:crypto');
const { performance, monitorEventLoopDelay } = await import('node:perf_hooks');
const { setTimeout: delay } = await import('node:timers/promises');
const { resolveEmbeddingArtifactIdentity, assertEmbeddingArtifactCompatibility } = await import('../../../src/shared/embedding-artifact-identity.js');
const { acquireEmbeddingArtifactLease, getEmbeddingArtifactLeaseMetrics } = await import('../../../src/shared/embedding-artifact-lease.js');
const { observeEmbeddingArtifactReads } = await import('../../helpers/embedding-artifact-work.js');
const { prepareIsolatedTestCacheDir } = await import('../../helpers/test-cache.js');

const [scope, arm, trial] = process.argv.slice(2);
assert.ok(['small', 'cold', 'concurrent', 'warm'].includes(scope));
assert.ok(['sync', 'async'].includes(arm)); assert.ok(['1', '2', '3'].includes(trial));
assert.equal(typeof global.gc, 'function');
const { dir } = await prepareIsolatedTestCacheDir(`artifact-lease-work-${scope}-${arm}-${trial}`);
const modelRoot = path.join(dir, 'fixture/model'), size = 1024 * 1024;
const rows = [['onnx/model.onnx', scope === 'small' ? size : 32 * size, 65],
  ['onnx/model_quantized.onnx', scope === 'small' ? size / 4 : 4 * size, 71],
  ['onnx/weights.data', scope === 'small' ? size / 4 : 8 * size, 83], ['tokenizer.json', 32768, 84]];
const inventory = [], options = { provider: 'xenova', modelId: 'fixture/model', modelsDir: dir };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let observation, heartbeat, monitor;
try {
  for (const [file, bytes, fill] of rows) {
    const target = path.join(modelRoot, ...file.split('/')), buffer = Buffer.alloc(bytes, fill);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, buffer);
    inventory.push({ path: file, bytes, sha256: sha(buffer) });
  }
  inventory.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const expectedDigest = sha(JSON.stringify(inventory)), bytesPerClosure = rows.reduce((n, row) => n + row[1], 0);
  const invoke = async clients => {
    if (arm === 'sync') {
      const selected = Array.from({ length: clients }, () => resolveEmbeddingArtifactIdentity(options));
      const loaded = selected.map(first => {
        const second = resolveEmbeddingArtifactIdentity(options); assertEmbeddingArtifactCompatibility(first, second); return second;
      });
      return loaded;
    }
    const leases = await Promise.all(Array.from({ length: clients }, () => acquireEmbeddingArtifactLease(options)));
    try { return await Promise.all(leases.map(lease => lease.verifyLoaded())); }
    finally { leases.forEach(lease => lease.release()); }
  };
  if (scope === 'warm') await invoke(1);
  global.gc(); global.gc();
  monitor = monitorEventLoopDelay({ resolution: 1 }); monitor.enable(); await delay(5);
  let measuring = false, heartbeatsDuringWork = 0;
  heartbeat = setInterval(() => { if (measuring) heartbeatsDuringWork++; }, 1);
  observation = observeEmbeddingArtifactReads(modelRoot);
  const before = getEmbeddingArtifactLeaseMetrics(), memoryBefore = process.memoryUsage(), cpuBefore = process.cpuUsage();
  const started = performance.now(); measuring = true;
  const results = [];
  if (scope === 'warm') for (let repeat = 0; repeat < 3; repeat++) results.push(...await invoke(1));
  else results.push(...await invoke(scope === 'concurrent' ? 8 : 1));
  measuring = false;
  const wallMs = performance.now() - started, cpuMicroseconds = process.cpuUsage(cpuBefore);
  const after = getEmbeddingArtifactLeaseMetrics(), memoryAfter = process.memoryUsage(), maxRssKiB = process.resourceUsage().maxRSS;
  observation.stop(); clearInterval(heartbeat); heartbeat = null;
  await delay(5); monitor.disable();
  const work = { ...observation.metrics }, verification = Object.fromEntries(['verifications', 'coalesced', 'filesHashed', 'bytesHashed']
    .map(key => [key, after[key] - before[key]]));
  const hashPasses = scope === 'warm' ? 6 : scope === 'concurrent' && arm === 'sync' ? 16 : 2;
  assert.equal(work.bytesRead, bytesPerClosure * hashPasses, 'independent original descriptor reads match the admitted verification passes');
  assert.ok(results.every(result => result.digest === expectedDigest));
  assert.deepEqual(results[0].inventory, inventory, 'all conservative graph/data/tokenizer bytes retain exact canonical identity');
  if (arm === 'async') {
    assert.equal(verification.verifications, hashPasses); assert.equal(verification.bytesHashed, work.bytesRead);
    assert.equal(verification.coalesced, scope === 'concurrent' ? 14 : 0);
    assert.ok(heartbeatsDuringWork > 0, 'actual async file reads yield the event loop while verifying');
  } else assert.equal(heartbeatsDuringWork, 0, 'the synchronous baseline blocks the invocation');
  assert.equal(after.active, 0); assert.equal(after.pending, 0);
  global.gc();
  console.log(JSON.stringify({ measurement: 'artifact-lease-verification-work', scope, arm, trial: Number(trial),
    node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch,
    inputDigest: sha(JSON.stringify(inventory)), outputDigest: results[0].digest, bytesPerClosure, hashPasses,
    clients: scope === 'concurrent' ? 8 : 1, repetitions: scope === 'warm' ? 3 : 1, work, verification,
    wallMs, cpuMicroseconds, memoryBefore, memoryAfter, memoryAfterCollection: process.memoryUsage(), maxRssKiB,
    heartbeatsDuringWork, eventLoopDelayNs: { min: monitor.min, max: monitor.max, mean: monitor.mean, p95: monitor.percentile(95) },
    cacheState: 'Fresh process; generated fixture bytes are filesystem-page-cache warm. Warm means repeated mutable selection, not zero I/O.',
    scopeLimit: 'Actual artifact verification only; synthetic graph/data bytes are not loaded into a model provider. Conservative sibling inventory is preserved. Heap is sampled; RSS includes fixture preparation.' }));
} finally {
  observation?.stop(); if (heartbeat) clearInterval(heartbeat); monitor?.disable();
  await fs.rm(dir, { recursive: true, force: true });
}
