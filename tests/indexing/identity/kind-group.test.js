#!/usr/bin/env node
import assert from 'node:assert/strict';
import { toKindGroup } from '../../../src/index/identity/kind-group.js';

const cases = new Map([
  ['function', 'function'],
  ['arrow_function', 'function'],
  ['generator', 'function'],
  ['class', 'class'],
  ['method', 'method'],
  ['constructor', 'method'],
  ['interface', 'type'],
  ['type', 'type'],
  ['enum', 'type'],
  ['variable', 'value'],
  ['const', 'value'],
  ['let', 'value'],
  ['module', 'module'],
  ['namespace', 'module'],
  ['file', 'module'],
  ['unknown', 'other'],
  [null, 'other'],
  ['', 'other']
]);

for (const [input, expected] of cases.entries()) {
  assert.equal(toKindGroup(input), expected, `kindGroup(${input})`);
}

console.log('identity kindGroup tests passed');
