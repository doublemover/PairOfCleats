#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createProviderPayloadRecord,
  MAX_PARAM_CANDIDATES,
  normalizeProviderPayload
} from '../../../src/index/tooling/provider-output-contract.js';

const observations = [];
const dropped = normalizeProviderPayload('not-an-object', {
  observations,
  providerId: 'shape-contract',
  chunkUid: 'chunk-a'
});
assert.deepEqual(dropped, createProviderPayloadRecord(), 'expected non-object payloads to normalize to empty object');
assert.equal(Object.getPrototypeOf(dropped), null, 'expected normalized payload record to use null prototype');
assert.equal(
  observations.some((entry) => entry?.code === 'tooling_payload_shape_invalid'),
  true,
  'expected invalid payload shape observation'
);

const invalidParamTypesObs = [];
const invalidParamTypes = normalizeProviderPayload({
  returnType: ' number ',
  signature: ' add(a:number): number ',
  paramTypes: ['bad']
}, {
  observations: invalidParamTypesObs,
  providerId: 'shape-contract',
  chunkUid: 'chunk-b'
});
assert.equal(invalidParamTypes.returnType, 'number');
assert.equal(invalidParamTypes.signature, 'add(a:number): number');
assert.equal(
  invalidParamTypesObs.some((entry) => entry?.code === 'tooling_payload_paramtypes_invalid'),
  true,
  'expected invalid paramTypes observation'
);

const overflowingTypes = Array.from({ length: MAX_PARAM_CANDIDATES + 3 }, (_, idx) => ({
  type: `T${idx + 1}`,
  confidence: idx / 10,
  source: 'shape-contract'
}));
const cappedObs = [];
const capped = normalizeProviderPayload({
  paramTypes: {
    zed: [{ type: 'string', source: 'shape-contract' }],
    arg: overflowingTypes
  }
}, {
  observations: cappedObs,
  providerId: 'shape-contract',
  chunkUid: 'chunk-c'
});
assert.equal(
  Object.getPrototypeOf(capped.paramTypes),
  null,
  'expected paramTypes map to use null prototype'
);
assert.equal(
  Array.isArray(capped.paramTypes.arg),
  true,
  'expected normalized param type list'
);
assert.equal(
  capped.paramTypes.arg[0]?.originalText,
  'T1',
  'expected original type text preservation'
);
assert.equal(
  typeof capped.paramTypes.arg[0]?.normalizedType,
  'string',
  'expected canonical type text on normalized entry'
);
assert.deepEqual(
  Object.keys(capped.paramTypes),
  ['arg', 'zed'],
  'expected paramTypes keys to be ordered deterministically'
);
assert.equal(
  capped.paramTypes.arg.length,
  MAX_PARAM_CANDIDATES,
  'expected param type list to be capped deterministically'
);
assert.equal(
  cappedObs.some((entry) => entry?.code === 'tooling_param_types_truncated'),
  true,
  'expected truncation observation'
);

console.log('provider output contract normalization test passed');
