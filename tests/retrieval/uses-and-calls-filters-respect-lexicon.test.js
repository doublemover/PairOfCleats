#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterRawRelationsWithLexicon } from '../../src/index/build/file-processor/lexicon-relations-filter.js';
import { buildFileRelations } from '../../src/index/build/file-processor/relations.js';
import { filterChunks } from '../../src/retrieval/output.js';

const rawRelations = {
  usages: ['if', 'print', 'value'],
  calls: [
    ['run', 'return'],
    ['run', 'print']
  ]
};

const filteredRelations = filterRawRelationsWithLexicon(rawRelations, {
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

const filePath = 'src/example.py';
const fileRelations = new Map([[filePath, buildFileRelations(filteredRelations, filePath)]]);
const chunks = [
  {
    id: 1,
    file: filePath,
    codeRelations: {
      calls: filteredRelations.calls,
      usages: filteredRelations.usages
    }
  }
];

const callsReturn = filterChunks(chunks, { calls: 'return' }, null, fileRelations);
const callsPrint = filterChunks(chunks, { calls: 'print' }, null, fileRelations);
const usesIf = filterChunks(chunks, { uses: 'if' }, null, fileRelations);

assert.equal(callsReturn.length, 0, 'expected --calls return to be filtered out by lexicon relations filtering');
assert.equal(callsPrint.length, 1, 'expected --calls print to remain (builtins are not dropped by default)');
assert.equal(usesIf.length, 0, 'expected --uses if to be filtered out by lexicon relations filtering');

console.log('uses and calls filters respect lexicon test passed');
