import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const assert = (await import('node:assert/strict')).default;
const { createHash } = await import('node:crypto');
const { performance } = await import('node:perf_hooks');
const { createRiskWitnessObservation, riskSemanticProjection } = await import('../../helpers/risk-witness-observation.js');
const { riskSpineScenario, riskBranchScenario, riskScenarioInput } = await import('../../helpers/risk-witness-scenarios.js');

const [scope, arm, trial] = process.argv.slice(2);
assert.ok(['candidate', 'reference'].includes(arm)); assert.ok(['1', '2', '3'].includes(trial));
const settings = {
  'spine4': { kind: 'spine', depth: 4, width: 128 }, 'spine12': { kind: 'spine', depth: 12, width: 128 },
  'spine20': { kind: 'spine', depth: 20, width: 128 },
  'branch4': { kind: 'branch', depth: 4, width: 256 }, 'branch20': { kind: 'branch', depth: 20, width: 256 },
  'spine20-wide': { kind: 'spine', depth: 20, width: 512 }
}[scope];
assert.ok(settings); assert.equal(typeof global.gc, 'function');
const scenario = settings.kind === 'spine' ? riskSpineScenario(settings) : riskBranchScenario(settings);
const input = riskScenarioInput(scenario), inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
const measured = createRiskWitnessObservation(arm, { deep: false });
let comparison;
try {
  const compute = await measured.load();
  global.gc(); global.gc();
  const memoryBefore = process.memoryUsage(), cpuBefore = process.cpuUsage(), started = performance.now();
  const result = measured.run(() => compute(input));
  const wallMs = performance.now() - started, cpuMicroseconds = process.cpuUsage(cpuBefore);
  const memoryAfter = process.memoryUsage(), processHighWaterRssKb = process.resourceUsage().maxRSS;
  const projection = riskSemanticProjection(result), outputDigest = createHash('sha256').update(JSON.stringify(projection)).digest('hex');
  global.gc(); const memoryAfterCollection = process.memoryUsage();
  const expectedFlows = settings.kind === 'spine' ? 1 : settings.width;
  assert.equal(result.flowRows.length, expectedFlows); assert.equal(result.partialFlowRows.length, 0);
  assert.equal(measured.metrics.materializations, expectedFlows);
  comparison = createRiskWitnessObservation(arm === 'candidate' ? 'reference' : 'candidate', { deep: false });
  // The other factory is loaded after measured memory/CPU were captured.
  const comparisonCompute = await comparison.load();
  const other = comparison.run(() => comparisonCompute(input));
  assert.deepEqual(riskSemanticProjection(other), projection);
  console.log(JSON.stringify({ scope, arm, trial: Number(trial), node: process.version, abi: process.versions.modules,
    platform: process.platform, settings, inputHash, outputDigest, flowCount: expectedFlows,
    work: measured.metrics, wallMs, cpuMicroseconds, memoryBefore, memoryAfter,
    memoryAfterCollection, processHighWaterRssKb,
    memoryScope: 'sampled heap during measured compute; process RSS high-water includes startup; validation excluded',
    measurementScope: 'real reconciled engine with matched scalar factory/Map probes; controlled representation comparison' }));
  // Keep raw measurements even when the original producer violates a bound.
  // Logging precedes these assertions; a failing bound still exits nonzero.
  if (arm === 'candidate') {
    assert.ok(measured.metrics.peakIndexEntries <= settings.width + 1);
    assert.ok(measured.metrics.peakOwnedQueueSlots <= settings.width + 1);
    assert.equal(measured.metrics.copiedPrefixSlots, 0); assert.ok(measured.metrics.reusedParentLinks > 0);
  } else {
    assert.ok(measured.metrics.copiedPrefixSlots > 0);
    assert.equal(measured.metrics.peakOwnedQueueSlots, measured.metrics.statesEnqueued);
  }
} finally { measured.dispose(); comparison?.dispose(); }
