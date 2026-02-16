#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterRawRelationsWithLexicon } from '../../src/index/build/file-processor/lexicon-relations-filter.js';

const rawRelations = {
  calls: [
    ['fn', 'obj.default'],
    ['fn', 'if']
  ],
  usages: ['default', 'if']
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
assert.deepEqual(filtered.usages, ['default'], 'expected usage "default" to remain for conservative js keywords');

console.log('lexicon relations filter keyword property test passed');
