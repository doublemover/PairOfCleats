#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildSerializedFilterIndex } from '../../../src/index/build/artifacts/filter-index.js';
import { discoverSegments, chunkSegments, assignSegmentUids } from '../../../src/index/segments.js';
import { buildMetaV2 } from '../../../src/index/metadata-v2.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { buildFilterIndex, serializeFilterIndex } from '../../../src/retrieval/filter-index.js';
import { hasActiveFilters } from '../../../src/retrieval/filters.js';
import { filterChunks } from '../../../src/retrieval/output.js';
import { applyBranchFilter } from '../../../src/retrieval/cli/branch-filter.js';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { stableStringify } from '../../../src/shared/stable-json.js';

const cases = [
  {
    name: 'active filter detection ignores cosmetic toggles and recognizes real narrowing',
    run() {
      assert.equal(hasActiveFilters(null), false);
      assert.equal(hasActiveFilters(undefined), false);
      assert.equal(hasActiveFilters({}), false);
      assert.equal(hasActiveFilters({ filePrefilter: { enabled: true } }), false);
      assert.equal(hasActiveFilters({ caseFile: true, caseTokens: true }), false);
      assert.equal(hasActiveFilters({ excludeTokens: ['alpha'], excludePhrases: ['beta'] }), false);

      assert.equal(hasActiveFilters({ ext: ['.js'] }), true);
      assert.equal(hasActiveFilters({ type: 'function' }), true);
      assert.equal(hasActiveFilters({ meta: [{ key: 'owner', value: 'me' }] }), true);
      assert.equal(hasActiveFilters({ churnMin: 0 }), true);
    }
  },
  {
    name: 'serialized filter index config hash ignores api token churn',
    run() {
      const chunk = {
        id: 0,
        file: 'src/example.js',
        lang: 'javascript'
      };
      const resolvedConfig = {
        chargramMinN: 3
      };
      const previousToken = process.env.PAIROFCLEATS_API_TOKEN;
      const runWithToken = (token) => {
        if (token === null) {
          delete process.env.PAIROFCLEATS_API_TOKEN;
        } else {
          process.env.PAIROFCLEATS_API_TOKEN = token;
        }
        return buildSerializedFilterIndex({
          chunks: [chunk],
          resolvedConfig,
          userConfig: {},
          root: process.cwd()
        }).configHash;
      };

      try {
        const hashA = runWithToken('token-a');
        const hashB = runWithToken('token-b');
        assert.ok(hashA);
        assert.equal(hashA, hashB);
      } finally {
        if (previousToken === undefined) {
          delete process.env.PAIROFCLEATS_API_TOKEN;
        } else {
          process.env.PAIROFCLEATS_API_TOKEN = previousToken;
        }
      }
    }
  },
  {
    name: 'effective language fallback normalizes unknown and valid language ids',
    run() {
      const chunks = [
        {
          id: 0,
          file: 'src/no-lang.js',
          ext: '.js',
          metaV2: {}
        },
        {
          id: 1,
          file: 'src/invalid-lang.ts',
          ext: '.ts',
          metaV2: {
            lang: { id: 'typescript' },
            effective: { languageId: '' }
          },
          lang: '   '
        },
        {
          id: 2,
          file: 'src/valid.py',
          ext: '.py',
          metaV2: {
            effective: { languageId: 'Python' }
          }
        }
      ];

      const index = buildFilterIndex(chunks, { includeBitmaps: false });
      const unknown = index.byLang.get('unknown');
      assert.ok(unknown && unknown.has(0), 'missing language should fall back to unknown');
      assert.ok(unknown && unknown.has(1), 'invalid language should fall back to unknown');

      const python = index.byLang.get('python');
      assert.ok(python && python.has(2), 'valid effective language should be normalized and indexed');
    }
  },
  {
    name: 'filter index buckets and serialization stay deterministic',
    run() {
      const meta = [
        {
          id: 0,
          file: 'docs/guide.md',
          ext: '.md',
          kind: 'Paragraph',
          last_author: 'Dana',
          docmeta: { visibility: 'public' },
          metaV2: { lang: 'typescript', effective: { languageId: 'typescript' } }
        },
        {
          id: 1,
          file: 'src/a.js',
          ext: '.js',
          kind: 'FunctionDeclaration',
          last_author: 'Alice',
          chunk_authors: ['Alice'],
          docmeta: { visibility: 'public' },
          metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } }
        },
        {
          id: 2,
          file: 'src/b.py',
          ext: '.py',
          kind: 'ClassDeclaration',
          last_author: 'Bob',
          chunk_authors: ['Bob', 'Alice'],
          docmeta: { visibility: 'private' },
          metaV2: { lang: 'python', effective: { languageId: 'python' } }
        },
        {
          id: 3,
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
      assert.ok(index.byLang?.get('typescript')?.has(0));
      assert.ok(index.byLang?.get('javascript')?.has(1));

      const serializedA = serializeFilterIndex(buildFilterIndex(meta));
      const serializedB = serializeFilterIndex(buildFilterIndex(meta));
      assert.equal(stableStringify(serializedA), stableStringify(serializedB));

      const expectIds = (filters, expected, label) => {
        const actual = filterChunks(meta, filters, index)
          .map((entry) => entry.id)
          .sort((a, b) => a - b);
        assert.deepEqual(actual, expected.slice().sort((a, b) => a - b), label);
      };

      expectIds({ ext: '.py', author: 'bob' }, [2], 'author+ext');
      expectIds({ chunkAuthor: 'alice' }, [1, 2], 'chunkAuthor');
      expectIds({ chunkAuthor: 'dana' }, [0], 'chunkAuthor fallback to last_author');
      expectIds({ visibility: 'public', type: 'FunctionDeclaration' }, [1, 3], 'visibility+type');
    }
  },
  {
    name: 'strict filter semantics cover signatures, relations, file matching, and unknown language fallback',
    run() {
      const meta = [
        {
          id: 0,
          kind: 'FunctionDeclaration',
          last_author: 'Alice',
          docmeta: { signature: 'foo(bar)', params: ['bar'] },
          codeRelations: { calls: [['foo', 'fetch']], usages: ['config'] },
          file: 'src/a.js',
          ext: '.js',
          metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } }
        },
        {
          id: 1,
          kind: 'FunctionDeclaration',
          docmeta: {},
          codeRelations: {},
          file: 'src/b.js',
          ext: '.js',
          metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } }
        },
        {
          id: 2,
          kind: 'ClassDeclaration',
          last_author: 'Bob',
          docmeta: { signature: 'baz()', params: ['baz'] },
          codeRelations: { calls: [['baz', 'other']], usages: ['other'] },
          file: 'src/c.js',
          ext: '.js',
          metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } }
        },
        {
          id: 3,
          docmeta: {},
          codeRelations: {},
          file: 'docs/readme.md',
          ext: '.md',
          metaV2: { lang: 'unknown', effective: { languageId: 'unknown' } }
        },
        {
          id: 4,
          kind: ['FunctionDeclaration', 'MethodDefinition'],
          last_author: ['Carol', 'Dana'],
          docmeta: { signature: 'qux()', params: ['qux'] },
          codeRelations: {},
          file: 'src/nested/util.ts',
          ext: '.ts',
          metaV2: { lang: 'typescript', effective: { languageId: 'typescript' } }
        },
        {
          id: 5,
          docmeta: {},
          codeRelations: {},
          file: 'docs/changelog.txt',
          ext: '.txt'
        },
        {
          id: 6,
          docmeta: {},
          codeRelations: {},
          file: 'docs/notes.md',
          ext: '.md',
          lang: '   '
        }
      ];
      const filterIndex = buildFilterIndex(meta, { fileChargramN: 3 });

      const expectIds = (filters, expected, label) => {
        const actual = filterChunks(meta, filters, filterIndex).map((entry) => entry.id).sort((a, b) => a - b);
        assert.deepEqual(actual, expected.slice().sort((a, b) => a - b), label);
      };

      expectIds({ signature: 'foo' }, [0], 'signature');
      expectIds({ param: 'bar' }, [0], 'param');
      expectIds({ calls: 'fetch' }, [0], 'calls');
      expectIds({ uses: 'config' }, [0], 'uses');
      expectIds({ type: 'FunctionDeclaration' }, [0, 1, 4], 'type strict');
      expectIds({ type: 'FunctionDeclaration ClassDeclaration' }, [0, 1, 2, 4], 'type multi');
      expectIds({ author: 'Alice' }, [0], 'author strict');
      expectIds({ author: 'car' }, [4], 'author substring');
      expectIds({ file: 'src/b.js', filePrefilter: { enabled: true, chargramN: 3 } }, [1], 'file substring');
      expectIds({ file: '/util\\.ts$/i', filePrefilter: { enabled: true, chargramN: 3 } }, [4], 'file regex');
      expectIds({ lang: 'unknown' }, [3, 5, 6], 'unknown language fallback');
    }
  },
  {
    name: 'lang filter matches embedded code segments rather than only container language',
    async run() {
      const text = [
        '# Guide',
        '',
        '```tsx',
        'export function greet(name: string) {',
        '  return name;',
        '}',
        '```',
        ''
      ].join('\n');
      const relPath = 'docs/guide.md';
      const ext = '.md';
      const segments = discoverSegments({
        text,
        ext,
        relPath,
        mode: 'prose',
        segmentsConfig: { inlineCodeSpans: false }
      });
      await assignSegmentUids({ text, segments, ext, mode: 'prose' });
      const chunks = chunkSegments({
        text,
        ext,
        relPath,
        mode: 'prose',
        segments,
        lineIndex: buildLineIndex(text),
        context: {}
      });

      const containerLang = getLanguageForFile(ext, relPath);
      const chunkMeta = chunks.map((chunk, id) => {
        const effectiveExt = chunk.segment?.ext || ext;
        const effectiveLang = getLanguageForFile(effectiveExt, relPath);
        const containerLanguageId = containerLang?.id || null;
        const lang = effectiveLang?.id || chunk.segment?.languageId || containerLanguageId || 'unknown';
        return {
          id,
          file: relPath,
          ext,
          kind: chunk.kind || null,
          name: chunk.name || null,
          metaV2: buildMetaV2({
            chunk: {
              ...chunk,
              file: relPath,
              ext,
              lang,
              containerLanguageId,
              effectiveExt
            },
            docmeta: {},
            toolInfo: { tool: 'pairofcleats', version: '0.0.0-test' },
            analysisPolicy: { metadata: { enabled: true } }
          })
        };
      });

      const hits = filterChunks(chunkMeta, { lang: 'typescript' }, buildFilterIndex(chunkMeta));
      assert.ok(hits.length > 0);
      assert.equal(hits.every((hit) => hit.metaV2?.lang === 'typescript'), true);
    }
  },
  {
    name: 'branch mismatch produces an empty typed payload while recording metrics',
    async run() {
      let recorded = null;
      const backendPolicy = { reason: 'auto', backendLabel: 'sqlite' };
      const result = await applyBranchFilter({
        branchFilter: 'main',
        caseSensitive: false,
        repoBranch: 'dev',
        backendLabel: 'sqlite',
        backendPolicy,
        emitOutput: false,
        jsonOutput: true,
        recordSearchMetrics: (status) => {
          recorded = status;
        }
      });

      assert.equal(result.matched, false);
      assert.equal(recorded, 'ok');
      assert.ok(result.payload);
      assert.equal(result.payload.backend, 'sqlite');
      assert.deepEqual(result.payload.prose, []);
      assert.deepEqual(result.payload.code, []);
      assert.deepEqual(result.payload.records, []);
      assert.equal(result.payload.stats.branch, 'dev');
      assert.equal(result.payload.stats.branchFilter, 'main');
      assert.equal(result.payload.stats.branchMatch, false);
      assert.deepEqual(result.payload.stats.backendPolicy, backendPolicy);
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('filter core contract matrix test passed');
