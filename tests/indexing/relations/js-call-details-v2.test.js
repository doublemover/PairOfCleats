#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCodeRelations } from '../../../src/lang/javascript.js';

const source = `
function alpha() {
  obj.method("alpha", 1, true, foo, bar, baz);
  fn(a(b()));
}
`;

const relations = buildCodeRelations(source, 'sample.js', { ext: '.js' });
const details = Array.isArray(relations?.callDetails) ? relations.callDetails : [];
assert.ok(details.length >= 2, 'expected at least two call details');

const methodCall = details.find((detail) => detail.calleeRaw === 'obj.method');
assert.ok(methodCall, 'expected obj.method call detail');
assert.equal(methodCall.calleeNormalized, 'method', 'calleeNormalized should use leaf name');
assert.equal(methodCall.receiver, 'obj', 'receiver should be object for member calls');
assert.ok(Number.isFinite(methodCall.startLine), 'startLine should be set');
assert.ok(Number.isFinite(methodCall.startCol), 'startCol should be set');
assert.ok(Array.isArray(methodCall.args), 'args should be an array');
assert.ok(methodCall.args.length <= 5, 'args should be capped');

console.log('js call details v2 test passed');
