import assert from 'node:assert/strict';
import { releaseOnnxResources } from '../../../src/shared/onnx-embeddings/resource-lifetime.js';
const order = [], primary = new Error('controlled initialization failure');
const sessionFailure = new Error('controlled session release failure'), tokenizerFailure = new Error('controlled tokenizer dispose failure');
const resources = { session: { release: async () => { order.push('session'); throw sessionFailure; } },
  tokenizer: { dispose: async () => { order.push('tokenizer'); throw tokenizerFailure; } },
  qualificationSlot: { release: () => { order.push('capacity'); } }, qualificationLease: { id: 'controlled-lease' } };
const failed = await releaseOnnxResources({ ...resources, primaryError: primary });
assert.equal(failed, primary); assert.deepEqual(order, ['session', 'tokenizer']);
assert.deepEqual(failed.cleanupErrors, [sessionFailure, tokenizerFailure]);
assert.equal(failed.cleanupFailureCount, 2); assert.equal(failed.cacheOwnershipPending, true);
assert.equal(failed.onnxSessionOwner.session, resources.session);
assert.equal(failed.onnxSessionOwner.tokenizer, resources.tokenizer);
assert.equal(failed.qualificationLease, resources.qualificationLease);
order.length = 0;
const stopped = await releaseOnnxResources({ ...resources });
assert.equal(stopped, sessionFailure); assert.deepEqual(stopped.cleanupErrors, [tokenizerFailure]);
assert.deepEqual(order, ['session', 'tokenizer']);
order.length = 0;
const cleanPrimary = new Error('controlled artifact verification failure');
const clean = await releaseOnnxResources({ ...resources, primaryError: cleanPrimary,
  session: { release: async () => { order.push('session'); } },
  tokenizer: { dispose: async () => { order.push('tokenizer'); } } });
assert.equal(clean, cleanPrimary); assert.deepEqual(order, ['session', 'tokenizer', 'capacity']);
assert.equal(clean.cacheOwnershipPending, undefined, 'successfully settled startup cleanup preserves only the primary failure');
order.length = 0;
const absent = await releaseOnnxResources({ tokenizer: { dispose: async () => { order.push('tokenizer'); } },
  qualificationSlot: resources.qualificationSlot });
assert.equal(absent, null); assert.deepEqual(order, ['tokenizer', 'capacity']);
console.log('ONNX reverse startup/disposal settlement and primary-error preservation assertions complete');
