#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildTypeScriptRelations } from '../../src/lang/typescript.js';

const source = `
function beta() {
  foo?.bar(1, 2, 3, 4, 5, 6);
}
`;

const relations = buildTypeScriptRelations(source, null, { ext: '.ts' });
const details = Array.isArray(relations?.callDetails) ? relations.callDetails : [];
assert.ok(details.length >= 1, 'expected call details from TS');

const call = details[0];
assert.ok(call.calleeRaw, 'calleeRaw should be set');
assert.ok(call.calleeNormalized, 'calleeNormalized should be set');
assert.ok(Number.isFinite(call.startLine), 'startLine should be set');
assert.ok(Number.isFinite(call.startCol), 'startCol should be set');
assert.ok(call.args.length <= 5, 'args should be capped');

console.log('ts call details v2 test passed');
