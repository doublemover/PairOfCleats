#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import { hasIndexMeta } from '../../../src/retrieval/cli/index-loader.js';
import { loadIndex, requireIndexDir } from '../../../src/retrieval/cli-index.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const withTempDir = async (prefix, run) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await run(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
};

const cases = [
  {
    name: 'detects manifest, binary-columnar, and compressed chunk meta layouts',
    async run() {
      applyTestEnv();
      await withTempDir('poc-index-layouts-', async (rootDir) => {
        const columnarDir = path.join(rootDir, 'index-columnar');
        await fs.mkdir(columnarDir, { recursive: true });
        await fs.writeFile(path.join(columnarDir, 'chunk_meta.columnar.json.zst'), '{}', 'utf8');
        assert.equal(hasIndexMeta(columnarDir), true);

        const binaryDir = path.join(rootDir, 'index-binary');
        await fs.mkdir(binaryDir, { recursive: true });
        await fs.writeFile(path.join(binaryDir, 'chunk_meta.binary-columnar.meta.json'), JSON.stringify({
          format: 'binary-columnar-v1',
          count: 1,
          data: 'chunk_meta.binary-columnar.bin',
          offsets: 'chunk_meta.binary-columnar.offsets.bin',
          lengths: 'chunk_meta.binary-columnar.lengths.varint'
        }, null, 2));
        await fs.writeFile(path.join(binaryDir, 'chunk_meta.binary-columnar.bin'), Buffer.from([1, 2, 3]));
        await fs.writeFile(path.join(binaryDir, 'chunk_meta.binary-columnar.offsets.bin'), Buffer.from([0, 0, 0, 0]));
        await fs.writeFile(path.join(binaryDir, 'chunk_meta.binary-columnar.lengths.varint'), Buffer.from([3]));
        assert.equal(hasIndexMeta(binaryDir), true);
        assert.equal(requireIndexDir(rootDir, 'code', {}, {
          resolveOptions: {
            indexDirByMode: { code: binaryDir },
            explicitRef: true
          },
          emitOutput: false,
          exitOnError: false
        }), binaryDir);

        const manifestDir = path.join(rootDir, 'index-manifest-only');
        await fs.mkdir(path.join(manifestDir, 'pieces'), { recursive: true });
        await fs.mkdir(path.join(manifestDir, 'custom'), { recursive: true });
        await fs.writeFile(
          path.join(manifestDir, 'custom', 'chunk_meta.jsonl'),
          '{"id":1,"file":"src/a.js","start":0,"end":1}\n'
        );
        await fs.writeFile(path.join(manifestDir, 'pieces', 'manifest.json'), JSON.stringify({
          version: 2,
          pieces: [
            { name: 'chunk_meta', path: 'custom/chunk_meta.jsonl', format: 'jsonl' }
          ]
        }, null, 2));
        assert.equal(hasIndexMeta(manifestDir), true);

        const emptyDir = path.join(rootDir, 'index-empty');
        await fs.mkdir(emptyDir, { recursive: true });
        assert.equal(hasIndexMeta(emptyDir), false);
        assert.throws(
          () => requireIndexDir(rootDir, 'code', {}, {
            resolveOptions: {
              indexDirByMode: { code: emptyDir },
              explicitRef: true
            },
            emitOutput: false,
            exitOnError: false
          }),
          (err) => err?.code === 'NO_INDEX'
        );
      });
    }
  },
  {
    name: 'strict token_postings loading fails while non-strict skips',
    async run() {
      applyTestEnv();
      await withTempDir('poc-index-token-strict-', async (rootDir) => {
        const indexDir = path.join(rootDir, 'index-code');
        await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
        await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([
          { id: 0, file: 'src/a.js', start: 0, end: 1 }
        ], null, 2));
        await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({
          version: 2,
          pieces: [{ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' }]
        }, null, 2));
        await assert.rejects(
          () => loadIndex(indexDir, { modelIdDefault: 'stub-model', strict: true }),
          /token_postings/i
        );
        const nonStrict = await loadIndex(indexDir, { modelIdDefault: 'stub-model', strict: false });
        assert.equal(nonStrict?.tokenIndex, undefined);
      });
    }
  },
  {
    name: 'lazy loading skips optional heavy artifacts',
    async run() {
      applyTestEnv();
      const { codeDir } = await ensureFixtureIndex({
        fixtureName: 'sample',
        cacheScope: 'shared',
        requiredModes: ['code']
      });
      const idx = await loadIndex(codeDir, {
        includeFileRelations: false,
        includeRepoMap: false,
        includeFilterIndex: false,
        includeDense: false,
        includeMinhash: false,
        includeTokenIndex: false,
        fileChargramN: 3,
        strict: true
      });
      assert.equal(idx.fileRelations, null);
      assert.equal(idx.repoMap, null);
      assert.equal(idx.filterIndex, null);
      assert.equal(idx.denseVec, null);
      assert.equal(idx.minhash, null);
      assert.equal(idx.tokenIndex, undefined);
    }
  },
  {
    name: 'binary chunk_meta fallback hydrates file refs under budget pressure',
    async run() {
      applyTestEnv({
        extraEnv: {
          PAIROFCLEATS_TEST_MAX_JSON_BYTES: '1024'
        }
      });
      await withTempDir('poc-index-binary-budget-', async (rootDir) => {
        const indexDir = path.join(rootDir, 'index-code');
        await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
        const chunkRows = [
          {
            id: 0,
            fileRef: 0,
            file: null,
            start: 0,
            end: 100,
            lang: 'javascript',
            kind: 'FunctionDeclaration',
            name: 'alpha',
            docmeta: { doc: `alpha-${'x'.repeat(500)}` }
          },
          {
            id: 1,
            fileRef: 1,
            file: null,
            start: 100,
            end: 240,
            lang: 'javascript',
            kind: 'FunctionDeclaration',
            name: 'beta',
            docmeta: { doc: `beta-${'y'.repeat(500)}` }
          }
        ];
        const encoded = encodeBinaryRowFrames(
          chunkRows.map((row) => Buffer.from(JSON.stringify(row), 'utf8'))
        );
        await fs.writeFile(path.join(indexDir, 'chunk_meta.binary-columnar.bin'), encoded.dataBuffer);
        await fs.writeFile(path.join(indexDir, 'chunk_meta.binary-columnar.offsets.bin'), encoded.offsetsBuffer);
        await fs.writeFile(path.join(indexDir, 'chunk_meta.binary-columnar.lengths.varint'), encoded.lengthsBuffer);
        await fs.writeFile(path.join(indexDir, 'chunk_meta.binary-columnar.meta.json'), JSON.stringify({
          fields: {
            format: 'binary-columnar-v1',
            count: chunkRows.length,
            data: 'chunk_meta.binary-columnar.bin',
            offsets: 'chunk_meta.binary-columnar.offsets.bin',
            lengths: 'chunk_meta.binary-columnar.lengths.varint'
          },
          arrays: {
            fileTable: ['src/alpha.js', 'src/beta.js']
          }
        }, null, 2));
        await writePiecesManifest(indexDir, [
          { name: 'chunk_meta', path: 'chunk_meta.binary-columnar.bin', format: 'binary-columnar' },
          { name: 'chunk_meta_binary_columnar_offsets', path: 'chunk_meta.binary-columnar.offsets.bin', format: 'binary' },
          { name: 'chunk_meta_binary_columnar_lengths', path: 'chunk_meta.binary-columnar.lengths.varint', format: 'varint' },
          { name: 'chunk_meta_binary_columnar_meta', path: 'chunk_meta.binary-columnar.meta.json', format: 'json' }
        ]);
        const loaded = await loadIndex(indexDir, {
          modelIdDefault: 'stub-model',
          strict: true,
          includeTokenIndex: false,
          includeFilterIndex: false,
          includeDense: false,
          includeMinhash: false,
          includeFileRelations: false,
          includeRepoMap: false,
          includeChunkMetaCold: false
        });
        assert.equal(loaded.chunkMeta.length, chunkRows.length);
        assert.equal(loaded.chunkMeta[0]?.file, 'src/alpha.js');
        assert.equal(loaded.chunkMeta[1]?.file, 'src/beta.js');
      });
    }
  },
  {
    name: 'binary file_meta fallback hydrates file paths under budget pressure',
    async run() {
      applyTestEnv({
        extraEnv: {
          PAIROFCLEATS_TEST_MAX_JSON_BYTES: '1024'
        }
      });
      await withTempDir('poc-index-file-meta-binary-budget-', async (rootDir) => {
        const indexDir = path.join(rootDir, 'index-code');
        await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
        await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([
          {
            id: 0,
            fileId: 0,
            file: null,
            start: 0,
            end: 42,
            lang: 'go',
            kind: 'FunctionDeclaration',
            name: 'alpha'
          }
        ]));
        const fileMetaRows = [
          {
            id: 0,
            file: 'src/alpha.go',
            ext: '.go',
            docmeta: { note: `large-${'x'.repeat(3000)}` }
          }
        ];
        const encoded = encodeBinaryRowFrames(
          fileMetaRows.map((row) => Buffer.from(JSON.stringify(row), 'utf8'))
        );
        await fs.writeFile(path.join(indexDir, 'file_meta.binary-columnar.bin'), encoded.dataBuffer);
        await fs.writeFile(path.join(indexDir, 'file_meta.binary-columnar.offsets.bin'), encoded.offsetsBuffer);
        await fs.writeFile(path.join(indexDir, 'file_meta.binary-columnar.lengths.varint'), encoded.lengthsBuffer);
        await fs.writeFile(path.join(indexDir, 'file_meta.binary-columnar.meta.json'), JSON.stringify({
          fields: {
            format: 'binary-columnar-v1',
            count: fileMetaRows.length,
            data: 'file_meta.binary-columnar.bin',
            offsets: 'file_meta.binary-columnar.offsets.bin',
            lengths: 'file_meta.binary-columnar.lengths.varint'
          }
        }, null, 2));
        await writePiecesManifest(indexDir, [
          { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
          { name: 'file_meta', path: 'file_meta.binary-columnar.bin', format: 'binary-columnar' },
          { name: 'file_meta_binary_columnar_offsets', path: 'file_meta.binary-columnar.offsets.bin', format: 'binary' },
          { name: 'file_meta_binary_columnar_lengths', path: 'file_meta.binary-columnar.lengths.varint', format: 'varint' },
          { name: 'file_meta_binary_columnar_meta', path: 'file_meta.binary-columnar.meta.json', format: 'json' }
        ]);
        const loaded = await loadIndex(indexDir, {
          modelIdDefault: 'stub-model',
          strict: true,
          includeTokenIndex: false,
          includeFilterIndex: false,
          includeDense: false,
          includeMinhash: false,
          includeFileRelations: false,
          includeRepoMap: false,
          includeChunkMetaCold: false
        });
        assert.equal(loaded.chunkMeta.length, 1);
        assert.equal(loaded.chunkMeta[0]?.file, 'src/alpha.go');
      });
    }
  },
  {
    name: 'dense vector binary meta refuses path traversal outside index root',
    async run() {
      applyTestEnv();
      await withTempDir('poc-index-dense-path-', async (rootDir) => {
        const indexDir = path.join(rootDir, 'index-code');
        await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
        await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([
          { id: 0, file: 'src/a.js', start: 0, end: 1, ext: '.js' }
        ], null, 2));
        await fs.writeFile(path.join(rootDir, 'outside.bin'), Buffer.from([1, 2, 3, 4]));
        await fs.writeFile(path.join(indexDir, 'dense_vectors_binary_meta.json'), JSON.stringify({
          path: '../outside.bin',
          dims: 2,
          count: 2
        }, null, 2));
        await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({
          version: 2,
          pieces: [
            { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
            { name: 'dense_vectors_binary_meta', path: 'dense_vectors_binary_meta.json', format: 'json' }
          ]
        }, null, 2));
        const idx = await loadIndex(indexDir, {
          modelIdDefault: 'stub-model',
          strict: false,
          includeFilterIndex: false,
          includeTokenIndex: false,
          includeHnsw: false,
          includeMinhash: false,
          fileChargramN: 3
        });
        assert.equal(idx?.denseVec, null);
      });
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('index loader contract matrix test passed');
