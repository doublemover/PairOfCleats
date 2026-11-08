import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs/promises');
const { prepareIsolatedTestCacheDir } = await import('../../helpers/test-cache.js');
const { installSemanticSerializationObservation } = await import('../../helpers/semantic-serialization-observation.js');
const [kind, layout, arm, trial] = process.argv.slice(2);
assert.ok(['query', 'operation'].includes(kind)); assert.ok(['memory', 'merged'].includes(layout));
assert.ok(['encoded', 'reencoded'].includes(arm)); assert.ok(['1', '2', '3'].includes(trial));
const instrumentation = installSemanticSerializationObservation();
const { createQueryWorkInput, loadQueryWorkArm, writeQueryWork } = await import('../../helpers/semantic-query-work.js');
const { semanticWorkDigest } = await import('../../helpers/semantic-prepared-work.js');
const { dir } = await prepareIsolatedTestCacheDir('semantic-query-work');
let observer;
try {
  const writer = await loadQueryWorkArm(arm), input = createQueryWorkInput(kind);
  const controlWriter = await loadQueryWorkArm(arm === 'encoded' ? 'reencoded' : 'encoded');
  global.gc(); global.gc(); observer = instrumentation.start(dir);
  const started = performance.now(), cpu = process.cpuUsage(), memoryBefore = process.memoryUsage();
  let measured;
  globalThis[Symbol.for('pairofcleats.test.semantic-query-stage')] = stage => {
    observer.switchPhase(stage);
    if (stage === 'observe') measured = { wallMs: performance.now() - started, cpuMicroseconds: process.cpuUsage(cpu),
      memoryAtStop: process.memoryUsage(), maxRssKiB: process.resourceUsage().maxRSS };
  };
  const path = await import('node:path');
  const result = await writeQueryWork(writer, path.join(dir, 'measured'), input, layout);
  observer.stop(); delete globalThis[Symbol.for('pairofcleats.test.semantic-query-stage')];
  const control = await writeQueryWork(controlWriter, path.join(dir, 'control'), createQueryWorkInput(kind), layout);
  assert.deepEqual(result.projection, control.projection); assert.equal(result.diskBytes, control.diskBytes);
  assert.equal(observer.phases.final.serializerCalls, input.entries.length * (arm === 'encoded' ? 1 : 2));
  console.log(JSON.stringify({ measurement: 'semantic-query-final-encoding-work', kind, layout, arm, trial: Number(trial),
    runtime: { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch },
    inputDigest: input.inputDigest, outputDigest: semanticWorkDigest(JSON.stringify(result.projection)),
    exactStoredBytesOffsetsHashesCountsKeysParity: true, rows: input.entries.length, ...measured, memoryBefore,
    work: observer.phases, phaseWallMs: observer.durationsMs, diskBytes: result.diskBytes, diskHighWater: result.diskHighWater,
    metrics: result.metrics,
    scope: 'Current immutable final-row encoding versus a redundant final-flush reencoding control. Intake and intermediate merge encodings are separate,not promised one-pass. Actual native filesystem work;direct Buffer allocation requests and sampled heap are not total V8 allocation. Same admission per layout;readback and opposite-arm parity excluded from measurement. Fresh process;RSS includes preparation.' }));
} finally {
  delete globalThis[Symbol.for('pairofcleats.test.semantic-query-stage')]; observer?.stop(); instrumentation.stop();
  await fs.rm(dir, { recursive: true, force: true });
}
