import assert from 'node:assert/strict';
import { buildQuantizeRunPayload } from '../../../src/index/build/workers/pool/payload.js';
const value = new Float32Array([1,2]);
const { payload, transferList } = buildQuantizeRunPayload({ vectors: [value,value,new Float32Array(value.buffer)] });
assert.equal(new Set(transferList).size,transferList.length);
assert.notEqual(payload.vectors[0].buffer,value.buffer);
structuredClone(payload,{ transfer:transferList });
assert.deepEqual(Array.from(value),[1,2]);
console.log('existing copied-vector ownership also prevents duplicate transfer buffers');
