#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterRawRelationsWithLexicon } from '../../src/index/build/file-processor/lexicon-relations-filter.js';

const rawRelations = {
  usages: ['value_a', 'if', 'value_b', 'true', 'value_c'],
  calls: [
    ['a', 'value_a'],
    ['a', 'if'],
    ['a', 'value_b'],
    ['a', 'true'],
    ['a', 'value_c']
  ]
};

const filtered = filterRawRelationsWithLexicon(rawRelations, {
  languageId: 'python',
  config: {
    enabled: true,
    relations: { enabled: true }
  }
});

assert.deepEqual(filtered.usages, ['value_a', 'value_b', 'value_c']);
assert.deepEqual(filtered.calls, [
  ['a', 'value_a'],
  ['a', 'value_b'],
  ['a', 'value_c']
]);

console.log('lexicon relations filter ordering test passed');
