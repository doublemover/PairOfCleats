#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  resolveVectorIngestEncoding,
  supportsQuantizedIngest
} from '../../../../tools/sqlite/vector-extension.js';

const noCapability = {
  ingestEncoding: 'auto',
  capabilities: { quantizedIngest: false }
};
assert.equal(supportsQuantizedIngest(noCapability), false, 'expected quantized ingest disabled');
assert.equal(
  resolveVectorIngestEncoding(noCapability),
  'float32',
  'expected auto ingest fallback to float32 when backend lacks support'
);
assert.equal(
  resolveVectorIngestEncoding({ ...noCapability, ingestEncoding: 'quantized' }),
  'float32',
  'expected explicit quantized ingest fallback to float32 without capability'
);

const withCapability = {
  ingestEncoding: 'auto',
  capabilities: { quantizedIngest: true }
};
assert.equal(supportsQuantizedIngest(withCapability), true, 'expected quantized ingest capability');
assert.equal(
  resolveVectorIngestEncoding(withCapability),
  'quantized',
  'expected auto ingest to pick quantized when capability exists'
);
assert.equal(
  resolveVectorIngestEncoding({ ...withCapability, ingestEncoding: 'float32' }),
  'float32',
  'expected explicit float32 ingest override'
);

console.log('sqlite vector ingest encoding test passed');
