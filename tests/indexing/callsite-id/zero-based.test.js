#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildCallSiteId } from '../../../src/index/callsite-id.js';

applyTestEnv();

const zeroBasedId = buildCallSiteId({
  file: 'src/example.py',
  startLine: 0,
  startCol: 0,
  endLine: 0,
  endCol: 5,
  calleeRaw: 'emit'
});
assert.ok(zeroBasedId, 'expected 0-based positions to produce callSiteId');

const oneBasedId = buildCallSiteId({
  file: 'src/example.py',
  startLine: 1,
  startCol: 1,
  endLine: 1,
  endCol: 6,
  calleeRaw: 'emit'
});
assert.ok(oneBasedId, 'expected 1-based positions to produce callSiteId');
assert.notEqual(zeroBasedId, oneBasedId, 'expected callSiteId to reflect exact coordinates');

const invalid = buildCallSiteId({
  file: 'src/example.py',
  startLine: -1,
  startCol: 0,
  endLine: 0,
  endCol: 1,
  calleeRaw: 'emit'
});
assert.equal(invalid, null, 'expected negative coordinates to be rejected');

console.log('callsite id zero-based test passed');
