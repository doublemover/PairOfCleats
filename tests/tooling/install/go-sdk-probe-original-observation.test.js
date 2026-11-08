import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { probeInstalledSdk } from '../../../tools/tooling/install-go-sdk.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/go-sdk-probe-original-observation/')[1];
assert.ok(['result-before-status', 'nested-before-fields', 'enclosing-between-fields', 'failure-before-result',
  'inspection-retains-independent-work', 'function-original-failure', 'closed-positive-and-late-observation'].includes(mode));
const resourceId = 'explicit-go-probe-observation-model', child = new EventEmitter();
let ready = ['enclosing-between-fields', 'inspection-retains-independent-work', 'closed-positive-and-late-observation'].includes(mode);
let reads = 0, laterReads = 0, coercions = 0;
const observed = value => Object.defineProperties(value, { cacheOwnershipPending: { value: false },
  cacheOwnershipReleased: { value() { assert.equal(this, value); return ready; } } });
const healthy = () => ({ exitCode: 0, signal: null, stdout: 'go version go1.27.1 windows/amd64', outputCapture: { stdout: { truncated: false } } });
let original, independent = null, spawn;
if (mode === 'closed-positive-and-late-observation') {
  original = Object.freeze(observed(healthy()));
  const report = await probeInstalledSdk('inert-owned-probe', { resourceId }, { spawn: async () => original });
  assert.equal(report.ok, true); assert.equal(report.stdout, original.stdout); assert.equal(report.status, 0);
  assert.deepEqual(report.settlement, { resourceId, settled: true, pending: false });
  assert.equal(report.cacheOwnershipReleased(), true); ready = false; assert.equal(report.cacheOwnershipReleased(), false);
  ready = true;
  const truncated = await probeInstalledSdk('inert-owned-probe', { resourceId }, { spawn: async () => ({ ...healthy(), outputCapture: { stdout: { truncated: true } } }) });
  assert.equal(truncated.ok, false);
  const nonzero = await probeInstalledSdk('inert-owned-probe', { resourceId }, { spawn: async () => ({ ...healthy(), exitCode: 2 }) });
  assert.equal(nonzero.ok, false); assert.equal(nonzero.status, 2);
} else {
  if (mode === 'failure-before-result' || mode === 'function-original-failure') {
    original = observed(mode === 'function-original-failure' ? function originalGoFailure() {} : new Error('original child work remains pending'));
    Object.defineProperties(original, { result: { get() { reads++; ready = true; return { termination: { closeObserved: true, treeCleanupSettled: true, treeCleanupFailed: false } }; } },
      [Symbol.toPrimitive]: { value: () => { coercions++; return 'coerced original'; } } }); Object.freeze(original);
    spawn = async (_command, _args, options) => { options.onSpawn(child); throw original; };
  } else if (mode === 'inspection-retains-independent-work') {
    ready = false; independent = Object.freeze(observed(new Error('independent result inspection work')));
    original = Object.freeze(Object.defineProperty(new Error('ordinary probe failure'), 'result', { get() { reads++; throw independent; } }));
    spawn = async () => { throw original; };
  } else {
    original = healthy();
    if (mode === 'nested-before-fields') {
      const output = observed({}); Object.defineProperty(output, 'stdout', { get() { reads++; ready = true; return { truncated: false }; } });
      original.outputCapture = Object.freeze(output);
    } else if (mode === 'enclosing-between-fields') {
      observed(original);
      Object.defineProperties(original, { exitCode: { get() { reads++; ready = false; return 0; } },
        signal: { get() { laterReads++; ready = true; return null; } } });
    } else {
      observed(original); Object.defineProperty(original, 'exitCode', { get() { reads++; ready = true; return 0; } });
    }
    Object.freeze(original); spawn = async () => original;
  }
  let failure;
  try { await probeInstalledSdk('inert-owned-probe', { resourceId }, { spawn }); } catch (error) { failure = error; }
  assert.ok(failure); assert.equal(errorGraphIncludes(failure, original), true); assert.equal(coercions, 0);
  if (independent) assert.equal(errorGraphIncludes(failure, independent), true);
  assert.equal(reads, ['enclosing-between-fields', 'inspection-retains-independent-work'].includes(mode) ? 1 : 0);
  assert.equal(laterReads, 0); assert.equal(failure.cacheOwnershipReleased(), false);
  child.emit('close'); assert.equal(failure.cacheOwnershipReleased(), false, 'close does not erase independent original work');
  ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
}
console.log('Go SDK probe retains original result, nested capture, failure and inspection observations.');
