import assert from 'node:assert/strict';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { createMapQualificationModel } from '../../../tools/bench/map/qualification-model.js';
import { runMapSerializationExperiment } from '../../../tools/bench/map/experiment.js';
import { applyTestEnv } from '../../helpers/test-env.js';
await requireBootstrap(); applyTestEnv();
const { profile, trial } = JSON.parse(process.argv[2]);
assert.ok(Number.isSafeInteger(trial) && trial >= 0 && trial < 6);
const model = createMapQualificationModel({ profile, root: process.cwd() });
const report = await runMapSerializationExperiment({ model, runs: 1,
  source: { kind: 'authored-synthetic-serializer-shape', generatorVersion: 1, profile, builderApplied: false } }, { firstRun: trial });
assert.equal(report.firstRun, trial); assert.equal(report.fixtureCleanup, 'completed');
assert.deepEqual(report.order.map(row => row.arm), trial % 2 ? ['streaming', 'baseline'] : ['baseline', 'streaming']);
assert.ok(report.inputIdentity.bytes >= (profile === 'medium' ? 8 : 24) * 1024 * 1024);
assert.ok(report.inputIdentity.bytes < 64 * 1024 * 1024);
for (const arm of ['baseline', 'streaming']) {
  assert.equal(report[arm].completedOperations, 1);
  const sample = report[arm].samples[0]; assert.equal(sample.consumerParity, 'parsed-content-identical');
  assert.equal(sample.gcObservation.state, 'observed'); assert.equal(sample.gcObservation.droppedEvents, 0);
  assert.equal(sample.memory.processLifetimeRss.state, 'observed');
  assert.equal(sample.memory.boundaryPolicy, 'before-and-after-only;transients-unobserved');
}
console.log(JSON.stringify(report));
