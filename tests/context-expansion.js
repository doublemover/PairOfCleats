#!/usr/bin/env node
import { expandContext } from '../src/search/context-expansion.js';

const chunkMeta = [
  { id: 0, file: 'src/a.js', name: 'alpha', codeRelations: { calls: [['alpha', 'beta']] } },
  { id: 1, file: 'src/b.js', name: 'beta' },
  { id: 2, file: 'src/c.js', name: 'gamma' }
];

const fileRelations = new Map([
  ['src/a.js', { importLinks: ['src/c.js'], usages: ['beta'], exports: [] }]
]);

const hits = [{ id: 0, file: 'src/a.js' }];
const contextHits = expandContext({
  hits,
  chunkMeta,
  fileRelations,
  repoMap: null,
  options: {
    maxPerHit: 5,
    maxTotal: 10,
    includeCalls: true,
    includeImports: true,
    includeUsages: true
  }
});

const ids = new Set(contextHits.map((hit) => hit.id));
if (!ids.has(1) || !ids.has(2)) {
  console.error('Expected context expansion to include call and import targets.');
  process.exit(1);
}

console.log('context expansion test passed');
