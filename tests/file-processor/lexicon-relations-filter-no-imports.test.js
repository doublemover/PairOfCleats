#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterRawRelationsWithLexicon } from '../../src/index/build/file-processor/lexicon-relations-filter.js';

const rawRelations = {
  imports: ['fs', 'path'],
  exports: ['run'],
  usages: ['if', 'run'],
  calls: [
    ['run', 'if'],
    ['run', 'execute']
  ]
};

const filtered = filterRawRelationsWithLexicon(rawRelations, {
  languageId: 'typescript',
  config: {
    enabled: true,
    relations: { enabled: true }
  }
});

assert.deepEqual(filtered.imports, rawRelations.imports, 'imports should not be filtered in v1');
assert.deepEqual(filtered.exports, rawRelations.exports, 'exports should not be filtered in v1');
assert.deepEqual(filtered.calls, [['run', 'execute']]);
assert.deepEqual(filtered.usages, ['run']);

console.log('lexicon relations filter no imports test passed');
