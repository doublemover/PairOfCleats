#!/usr/bin/env node
import { buildFilterIndex } from '../src/search/filter-index.js';
import { filterChunks } from '../src/search/output.js';

const meta = [
  {
    id: 0,
    ext: '.js',
    kind: 'FunctionDeclaration',
    last_author: 'Alice',
    chunk_authors: ['Alice'],
    docmeta: { visibility: 'public' }
  },
  {
    id: 1,
    ext: '.py',
    kind: 'ClassDeclaration',
    last_author: 'Bob',
    chunk_authors: ['Bob', 'Alice'],
    docmeta: { visibility: 'private' }
  },
  {
    id: 2,
    ext: '.py',
    kind: 'FunctionDeclaration',
    last_author: 'Carol',
    chunk_authors: ['Carol'],
    docmeta: { visibility: 'public' }
  }
];

const index = buildFilterIndex(meta);

const expectIds = (filters, expected, label) => {
  const results = filterChunks(meta, filters, index).map((entry) => entry.id).sort();
  const expectedSorted = expected.slice().sort();
  const same = results.length === expectedSorted.length
    && results.every((id, i) => id === expectedSorted[i]);
  if (!same) {
    console.error(`${label} failed: expected ${expectedSorted.join(', ')} got ${results.join(', ')}`);
    process.exit(1);
  }
};

expectIds({ ext: '.py', author: 'bob' }, [1], 'author+ext');
expectIds({ chunkAuthor: 'alice' }, [0, 1], 'chunkAuthor');
expectIds({ visibility: 'public', type: 'FunctionDeclaration' }, [0, 2], 'visibility+type');

console.log('Filter index test passed');
