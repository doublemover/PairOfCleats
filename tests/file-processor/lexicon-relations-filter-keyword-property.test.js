#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterRawRelationsWithLexicon } from '../../src/index/build/file-processor/lexicon-relations-filter.js';

const rawRelations = {
  calls: [
    ['fn', 'obj.default'],
    ['fn', 'if']
  ],
  usages: ['default', 'if'],
  callDetails: [
    { caller: 'fn', callee: 'obj.default', start: 3 },
    { caller: 'fn', callee: 'if', start: 20 }
  ],
  callDetailsWithRange: [
    { caller: 'fn', callee: 'obj.default', range: { start: 3, end: 14 } },
    { caller: 'fn', callee: 'if', range: { start: 20, end: 22 } }
  ]
};

const filtered = filterRawRelationsWithLexicon(rawRelations, {
  languageId: 'javascript',
  config: {
    enabled: true,
    relations: {
      enabled: true,
      drop: {
        keywords: true,
        literals: true,
        builtins: false,
        types: false
      }
    }
  }
});

assert.deepEqual(filtered.calls, [['fn', 'obj.default']], 'expected property name "default" to be preserved');
assert.deepEqual(filtered.usages, [], 'expected bare usage "default" to be filtered as a javascript keyword');
assert.deepEqual(filtered.callDetails, [rawRelations.callDetails[0]], 'qualified keyword calls keep their exact source details');
assert.deepEqual(filtered.callDetailsWithRange, [rawRelations.callDetailsWithRange[0]], 'qualified keyword calls keep their exact ranges');

console.log('lexicon relations filter keyword property test passed');
