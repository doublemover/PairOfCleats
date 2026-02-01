#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCallSiteId } from '../../../../src/index/callsite-id.js';
import { buildLocalPointerHash } from '../../../../src/index/build/shared/graph/graph-store.js';

const input = {
  file: 'src/example.js',
  startLine: 4,
  startCol: 2,
  endLine: 4,
  endCol: 9,
  calleeRaw: 'doWork'
};

const expected = buildCallSiteId(input);
const actual = buildLocalPointerHash(input);
assert.equal(actual, expected, 'local pointer hash should match callsite id');

console.log('local pointer hash test passed');
