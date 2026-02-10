#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCodeRelations } from '../../../src/lang/javascript.js';

const source = [
  'import client from "./client.js";',
  'export function run() {',
  '  return client.fetch("/api");',
  '}'
].join('\n');

const rel = buildCodeRelations(source, 'sample.js') || {};
const calls = Array.isArray(rel.calls) ? rel.calls : [];
const callDetails = Array.isArray(rel.callDetails) ? rel.callDetails : [];

assert.equal(calls.some(([from, to]) => from === 'run' && to === 'client.fetch'), true);
const detail = callDetails.find((entry) => entry.caller === 'run' && entry.callee === 'client.fetch');
assert.ok(detail, 'call detail should include caller/callee pair');
assert.equal(detail.calleeRaw, 'client.fetch');
assert.equal(detail.calleeNormalized, 'fetch');
assert.equal(detail.receiver, 'client');
assert.equal(Number.isFinite(detail.start), true);
assert.equal(Number.isFinite(detail.end), true);
assert.equal(Number.isFinite(detail.startLine), true);

console.log('javascript relations contract test passed');
