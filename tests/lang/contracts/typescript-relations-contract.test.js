#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildTypeScriptRelations } from '../../../src/lang/typescript.js';

const source = [
  'import { helper } from "./helper";',
  'export function runService(input: string) {',
  '  const svc = createService();',
  '  return svc.execute(input, helper());',
  '}'
].join('\n');

const chunks = [{
  name: 'runService',
  kind: 'FunctionDeclaration',
  start: source.indexOf('export function runService'),
  end: source.length
}];

const rel = buildTypeScriptRelations(source, chunks, { ext: '.ts' }) || {};
const calls = Array.isArray(rel.calls) ? rel.calls : [];
const callDetails = Array.isArray(rel.callDetails) ? rel.callDetails : [];

assert.equal(calls.some(([from, to]) => from === 'runService' && to === 'svc.execute'), true);
const detail = callDetails.find((entry) => entry.caller === 'runService' && entry.callee === 'svc.execute');
assert.ok(detail, 'typescript call detail should include caller/callee pair');
assert.equal(detail.calleeRaw, 'svc.execute');
assert.equal(detail.calleeNormalized, 'execute');
assert.equal(detail.receiver, 'svc');
assert.equal(Number.isFinite(detail.start), true);
assert.equal(Number.isFinite(detail.end), true);

console.log('typescript relations contract test passed');
