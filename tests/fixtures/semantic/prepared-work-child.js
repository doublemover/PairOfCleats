import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs/promises');
const path = await import('node:path');
const { prepareIsolatedTestCacheDir } = await import('../../helpers/test-cache.js');
const { ensureTestingEnv } = await import('../../helpers/test-env.js');
const { installSemanticSerializationObservation } = await import('../../helpers/semantic-serialization-observation.js');
ensureTestingEnv(process.env);
const [shape, arm, trial] = process.argv.slice(2);
assert.ok(['small', 'nodes', 'operands', 'mixed'].includes(shape));
assert.ok(['prepared', 'plain'].includes(arm)); assert.ok(['1', '2', '3'].includes(trial));
assert.equal(typeof global.gc, 'function');
const instrumentation = installSemanticSerializationObservation();
const { createPreparedWorkInput, writePreparedWork, semanticWorkDigest } = await import('../../helpers/semantic-prepared-work.js');
const { dir } = await prepareIsolatedTestCacheDir('semantic-prepared-work-' + shape + '-' + arm);
let observer;
try {
  const input = createPreparedWorkInput(shape);
  global.gc(); global.gc();
  observer = instrumentation.start(dir);
  const started = performance.now(), cpu = process.cpuUsage(), memoryBefore = process.memoryUsage();
  let measured;
  const result = await writePreparedWork(path.join(dir, 'measured'), input, arm, { phase: value => {
    observer.switchPhase(value);
    if (value === 'observe') measured = { wallMs: performance.now() - started, cpuMicroseconds: process.cpuUsage(cpu), memoryAtStop: process.memoryUsage(), maxRssKiB: process.resourceUsage().maxRSS };
  } });
  observer.stop();
  const control = await writePreparedWork(path.join(dir, 'control'), createPreparedWorkInput(shape), arm === 'prepared' ? 'plain' : 'prepared');
  assert.deepEqual(result.projection, control.projection);
  assert.equal(result.diskBytes, control.diskBytes);
  const envelopeCalls = Object.values(observer.phases).reduce((sum, row) => sum + row.envelopeCalls, 0);
  assert.equal(envelopeCalls, input.rows.length * (arm === 'prepared' ? 1 : 2));
  assert.ok(result.descriptor.members.semantic_records.length > 0);
  console.log(JSON.stringify({ measurement: 'semantic-prepared-row-work', shape, arm, trial: Number(trial),
    runtime: { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch },
    inputDigest: input.inputDigest, outputDigest: semanticWorkDigest(JSON.stringify(result.projection)),
    exactStoredBytesOffsetsHashesCountsParity: true, rows: input.rows.length, sourceBytes: input.bytes.length,
    work: observer.phases, phaseWallMs: observer.durationsMs, ...measured, memoryBefore, diskBytes: result.diskBytes,
    sourceState: 'Fresh process;deterministic source and rows prepared before measurement;durable real sink and native filesystem operations.',
    scope: 'Current plain-row fallback versus owned prepared entries,not an old checkout. Counts real top-level canonical calls and direct Buffer allocation requests,not all V8 allocations. Instrumentation is identical and samples heap. Phase times separate producer encoding, sink append and finalization;verification readback/control parity are outside timing. Process RSS includes input preparation.' }));
} finally { observer?.stop(); instrumentation.stop(); await fs.rm(dir, { recursive: true, force: true }); }
