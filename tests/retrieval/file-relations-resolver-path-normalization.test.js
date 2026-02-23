#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveFileRelations } from '../../src/retrieval/file-relations-resolver.js';

const directStore = new Map([
  ['src/utils/helper.ts', { imports: ['alpha'] }]
]);

const direct = resolveFileRelations(directStore, 'src\\utils\\helper.ts', true);
assert.deepEqual(direct, { imports: ['alpha'] }, 'expected separator-normalized direct lookup to match');

const caseInsensitiveStore = new Map([
  ['src/Feature.ts', { imports: ['beta'] }]
]);
const folded = resolveFileRelations(caseInsensitiveStore, 'SRC\\FEATURE.TS', false);
assert.deepEqual(folded, { imports: ['beta'] }, 'expected case-insensitive normalized lookup to match');

const ambiguousStore = new Map([
  ['src/Foo.ts', { marker: 'upper' }],
  ['src/foo.ts', { marker: 'lower' }]
]);
assert.equal(
  resolveFileRelations(ambiguousStore, 'SRC\\FOO.TS', false),
  null,
  'expected ambiguous case-insensitive lookup to stay fail-closed'
);

const objectStore = {
  'src/docs/readme.md': { usages: ['gamma'] }
};
const objectResolved = resolveFileRelations(objectStore, 'src\\docs\\readme.md', false);
assert.deepEqual(objectResolved, { usages: ['gamma'] }, 'expected object store lookup to normalize separators');

console.log('file relations resolver path normalization test passed');
