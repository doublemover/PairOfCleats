#!/usr/bin/env node
import assert from 'node:assert/strict';

import { bitmapToArray, getBitmapSize, isRoaringAvailable } from '../../../src/retrieval/bitmap.js';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { compileFilterPredicates } from '../../../src/retrieval/output/filters.js';
import { filterChunks, filterChunkIds } from '../../../src/retrieval/output.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const cases = [
  {
    name: 'bitmap allowlist matches filterChunks results',
    run() {
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
          file: 'src/b.js',
          ext: '.js',
          kind: 'ClassDeclaration',
          last_author: 'Bob',
          chunk_authors: ['Bob'],
          docmeta: { visibility: 'private' },
          metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } }
        },
        {
          id: 2,
          file: 'src/c.py',
          ext: '.py',
          kind: 'FunctionDeclaration',
          last_author: 'Alice',
          chunk_authors: ['Alice'],
          docmeta: { visibility: 'public' },
          metaV2: { lang: 'python', effective: { languageId: 'python' } }
        }
      ];
      const index = buildFilterIndex(meta);
      const filters = { ext: '.js', author: 'alice' };
      const expected = filterChunks(meta, filters, index)
        .map((entry) => entry.id)
        .sort((a, b) => a - b);
      const allowed = filterChunkIds(meta, filters, index, null, { preferBitmap: true });
      const allowedIds = allowed == null
        ? meta.map((entry) => entry.id)
        : (allowed instanceof Set ? Array.from(allowed) : bitmapToArray(allowed));
      allowedIds.sort((a, b) => a - b);
      assert.deepEqual(allowedIds, expected);
    }
  },
  {
    name: 'short-circuit returns null for no narrowing and empty allowlist for no matches',
    run() {
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
          chunk_authors: ['Bob'],
          docmeta: { visibility: 'private' },
          metaV2: { lang: 'python', effective: { languageId: 'python' } }
        }
      ];
      const index = buildFilterIndex(meta);
      const allResult = filterChunkIds(meta, {}, index);
      assert.equal(allResult, null);
      const noneResult = filterChunkIds(meta, { ext: '.rs' }, index, null, { preferBitmap: true });
      const noneCount = noneResult ? getBitmapSize(noneResult) : 0;
      assert.equal(noneCount, 0);
    }
  },
  {
    name: 'bitmap threshold switches between bitmap and Set outputs',
    run() {
      if (!isRoaringAvailable()) return;
      const meta = Array.from({ length: 12 }, (_, idx) => ({
        id: idx,
        file: `src/${idx}.js`,
        ext: '.js',
        kind: 'FunctionDeclaration',
        last_author: 'Alice',
        chunk_authors: ['Alice'],
        docmeta: { visibility: 'public' },
        metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } }
      }));
      const index = buildFilterIndex(meta);
      const filters = { ext: '.js' };
      const bitmapResult = filterChunkIds(meta, filters, index, null, {
        preferBitmap: true,
        bitmapMinSize: 4
      });
      assert.ok(bitmapResult && !(bitmapResult instanceof Set));
      assert.equal(getBitmapSize(bitmapResult), meta.length);
      const setResult = filterChunkIds(meta, filters, index, null, {
        preferBitmap: true,
        bitmapMinSize: 20
      });
      assert.ok(setResult instanceof Set);
      assert.equal(setResult.size, meta.length);
    }
  },
  {
    name: 'compiled filter predicates stay reusable while matching chunk filtering results',
    run() {
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
          file: 'src/b.js',
          ext: '.js',
          kind: 'ClassDeclaration',
          last_author: 'Bob',
          chunk_authors: ['Bob'],
          docmeta: { visibility: 'private' },
          metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } }
        },
        {
          id: 2,
          file: 'tests/c.ts',
          ext: '.ts',
          kind: 'FunctionDeclaration',
          last_author: 'Alice',
          chunk_authors: ['Alice'],
          docmeta: { visibility: 'public' },
          metaV2: { lang: 'typescript', effective: { languageId: 'typescript' } }
        }
      ];
      const index = buildFilterIndex(meta);
      const filters = {
        file: '/src/.*\\.js$/',
        ext: '.js',
        caseFile: false
      };

      const compiled = compileFilterPredicates(filters, { fileChargramN: 3 });
      const matcherRef = compiled.fileMatchers;

      const expected = filterChunks(meta, filters, index)
        .map((entry) => entry.id)
        .sort((a, b) => a - b);

      const allowed = filterChunkIds(meta, filters, index, null, { compiled, preferBitmap: true });
      const allowedIds = allowed == null
        ? meta.map((entry) => entry.id)
        : (allowed instanceof Set ? Array.from(allowed) : bitmapToArray(allowed));
      allowedIds.sort((a, b) => a - b);

      assert.deepEqual(allowedIds, expected);
      assert.equal(compiled.fileMatchers, matcherRef);
    }
  }
];

for (const testCase of cases) {
  testCase.run();
}

console.log('filter bitmap contract matrix test passed');
