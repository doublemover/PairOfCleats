import assert from 'node:assert/strict';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { probeNativePackage } from '../../../src/shared/native-package-probe.js';
import { inspectNativeOnnxParity, NATIVE_ONNX_IMPORT_ORDERS } from '../../../src/shared/native-onnx-probe.js';
import { applyTestEnv } from '../../helpers/test-env.js';

await requireBootstrap(); applyTestEnv();
const parity = inspectNativeOnnxParity(process.cwd());
assert.equal(parity.root.version, parity.transformers.requiredVersion); assert.equal(parity.huggingface.version, parity.root.version);
assert.equal(parity.root.packageRoot, parity.huggingface.packageRoot); assert.equal(parity.root.addon, parity.huggingface.addon);
const actual = await probeNativePackage(process.cwd(), 'onnxruntime-node');
console.log(JSON.stringify({ phase: 'original-native-onnx-lifecycle', ...actual }));
assert.equal(actual.ok, true, actual.message); assert.deepEqual(actual.parity, parity);
assert.deepEqual(actual.orders.map(row => row.order), NATIVE_ONNX_IMPORT_ORDERS);
for (const row of actual.orders) {
  assert.equal(row.status, 'passed'); assert.equal(row.loadability, 'passed'); assert.equal(row.lifecycle, 'passed');
  assert.equal(row.naturalExit, true); assert.equal(row.process.exitCode, 0); assert.equal(row.process.signal, null);
  assert.equal(row.process.stderr, ''); assert.equal(row.process.termination, undefined);
  assert.equal(row.timeoutMs, 10000); assert.equal(row.retries, 0); assert.ok(row.durationMs >= 0 && row.durationMs < 10000);
  assert.equal(row.receipt.model.bytes, 83); assert.equal(row.receipt.version, parity.selectedVersion);
  assert.deepEqual(row.receipt.consumers.map(consumer => consumer.consumer), ['root', 'huggingface']);
  for (const consumer of row.receipt.consumers) {
    assert.deepEqual(consumer.output, [1.25, -2]); assert.deepEqual(consumer.dimensions, [2]);
    assert.equal(consumer.sessionReleased, true); assert.equal(consumer.tensorResourcesObserved, 2);
    assert.equal(consumer.tensorResourcesSettled, 2); assert.equal(consumer.retainedTensorScopes, 0);
  }
}
assert.deepEqual(actual.capabilities.map(row => row.kind), ['native-runtime-loadability', 'native-runtime-lifecycle']);
assert.ok(actual.capabilities.every(row => row.verified === true));
console.log('Original ONNX bootstrap consumer parity, both native import orders and natural lifecycle passed.');
