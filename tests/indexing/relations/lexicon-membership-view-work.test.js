#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterRawRelationsWithLexicon } from '../../../src/index/build/file-processor/lexicon-relations-filter.js';
let visits = 0;
class RecordingSet extends Set { *[Symbol.iterator]() { for (const value of super[Symbol.iterator]()) { visits += 1; yield value; } } }
const keywords = new RecordingSet(Array.from({ length: 100 }, (_, index) => `keyword${index}`));
const lexicon = { stopwords: new Set(), keywords, literals: new Set(), builtins: new Set(), types: new Set() };
for (let index = 0; index < 100; index += 1) {
  const actual = filterRawRelationsWithLexicon({ calls: [['f', 'keyword1'], ['f', 'obj.keyword1'], ['f', 'keep']], usages: ['keyword1', 'keep'] }, { lexicon, languageId: 'fixture' });
  assert.deepEqual(actual.calls, [['f', 'obj.keyword1'], ['f', 'keep']]); assert.deepEqual(actual.usages, ['keep']);
}
assert.equal(visits, 0, 'membership views do not copy lexicon tokens per file');
keywords.add('later');
assert.deepEqual(filterRawRelationsWithLexicon({ usages: ['later'] }, { lexicon }).usages, []);
