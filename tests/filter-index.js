#!/usr/bin/env node
import { buildFilterIndex, serializeFilterIndex } from '../src/retrieval/filter-index.js';
import { filterChunks } from '../src/retrieval/output.js';
import { stableStringify } from '../src/shared/stable-json.js';

const meta = [
  {
    id: 0,
    file: 'src/a.js',
    ext: '.js',
    kind: 'FunctionDeclaration',
    last_author: 'Alice',
    chunk_authors: ['Alice'],
    docmeta: { visibility: 'public' },
    metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } }
  },
  {
    id: 1,
    file: 'src/b.py',
    ext: '.py',
    kind: 'ClassDeclaration',
    last_author: 'Bob',
    chunk_authors: ['Bob', 'Alice'],
    docmeta: { visibility: 'private' },
    metaV2: { lang: 'python', effective: { languageId: 'python' } }
  },
  {
    id: 2,
    file: 'src/c.py',
    ext: '.py',
    kind: 'FunctionDeclaration',
    last_author: 'Carol',
    chunk_authors: ['Carol'],
    docmeta: { visibility: 'public' },
    metaV2: { lang: 'python', effective: { languageId: 'python' } }
  }
];

const index = buildFilterIndex(meta);
const serializedA = serializeFilterIndex(buildFilterIndex(meta));
const serializedB = serializeFilterIndex(buildFilterIndex(meta));
if (stableStringify(serializedA) !== stableStringify(serializedB)) {
  console.error('Filter index serialization should be deterministic for identical inputs.');
  process.exit(1);
}

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
