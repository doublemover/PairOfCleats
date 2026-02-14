#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterRawRelationsWithLexicon } from '../../src/index/build/file-processor/lexicon-relations-filter.js';

const rawRelations = {
  imports: ['os'],
  exports: ['run'],
  usages: ['if', 'print', 'true', 'value'],
  calls: [
    ['run', 'if'],
    ['run', 'print'],
    ['run', 'obj.value']
  ],
  callDetails: [
    { caller: 'run', callee: 'if', line: 1, col: 1 },
    { caller: 'run', callee: 'print', line: 2, col: 1 },
    { caller: 'run', callee: 'obj.value', line: 3, col: 1 }
  ],
  callDetailsWithRange: [
    { caller: 'run', callee: 'if', range: { start: 0, end: 2 } },
    { caller: 'run', callee: 'print', range: { start: 3, end: 8 } }
  ]
};

const filtered = filterRawRelationsWithLexicon(rawRelations, {
  languageId: 'python',
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

assert.deepEqual(filtered.usages, ['print', 'value']);
assert.deepEqual(filtered.calls, [
  ['run', 'print'],
  ['run', 'obj.value']
]);
assert.deepEqual(filtered.callDetails.map((entry) => entry.callee), ['print', 'obj.value']);
assert.deepEqual(filtered.callDetailsWithRange.map((entry) => entry.callee), ['print']);

console.log('lexicon relations filter test passed');
