#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPostings } from '../../../src/index/build/postings.js';
import { writeIndexArtifacts } from '../../../src/index/build/artifacts.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { loadPiecesManifestPieces } from '../../helpers/pieces-manifest.js';

const testRoot = resolveTestCachePath(process.cwd(), 'minhash-stream-publication');
await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(testRoot, { recursive: true });
applyTestEnv({ testing: '1', cacheRoot: path.join(testRoot, 'cache') });
const readOptional = async (filename, json = false) => {
  try {
    const bytes = await fs.readFile(filename);
    return json ? JSON.parse(bytes) : bytes;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

for (const [caseIndex, scenario] of [
  { count: 0, maxDocs: 2, packedOnly: false },
  { count: 2, maxDocs: 4, packedOnly: false },
  { count: 7, maxDocs: 2, packedOnly: false },
  { count: 7, maxDocs: 2, packedOnly: true },
  { count: 2, maxDocs: 4, packedOnly: false, failMeta: true }
].entries()) {
  const captures = [];
  for (const streaming of scenario.failMeta ? [true] : [false, true]) {
    const outDir = path.join(testRoot, `${caseIndex}-${streaming}`);
    await fs.mkdir(outDir, { recursive: true });
    const chunks = Array.from({ length: scenario.count }, (_, id) => ({
      id, file: `file-${id}.js`, start: 0, end: 1, tokens: [], tokenCount: 0,
      chunkUid: `ck64:v1:minhash-fixture:${id.toString(16).padStart(16, '0')}`,
      virtualPath: `file-${id}.js`,
      metaV2: { schemaVersion: 3, chunkUid: `ck64:v1:minhash-fixture:${id.toString(16).padStart(16, '0')}`, virtualPath: `file-${id}.js` },
      minhashSig: Array.from({ length: 64 }, (_, col) => id * 1000 + col)
    }));
    const state = {
      chunks, scannedFilesTimes: [], scannedFiles: [], skippedFiles: [], totalTokens: 0,
      fileRelations: new Map(), fileInfoByPath: new Map(), fileDetailsByPath: new Map(),
      chunkUidToFile: new Map(), docLengths: [], vfsManifestRows: [],
      vfsManifestCollector: null, fieldTokens: [], importResolutionGraph: null
    };
    const postingsConfig = { minhashMaxDocs: scenario.maxDocs, minhashStream: streaming };
    const postings = await buildPostings({
      chunks, df: new Map(), tokenPostings: new Map(), docLengths: [],
      fieldPostings: {}, fieldDocLengths: {}, phrasePost: new Map(), triPost: new Map(),
      postingsConfig, embeddingsEnabled: false, modelId: 'stub', useStubEmbeddings: true,
      log: () => {}
    });
    const indexState = {
      buildId: 'artifact-publication-fixture',
      mode: 'code', counts: { files: scenario.count, chunks: scenario.count }, extensions: {}
    };
    const originalCreateReadStream = fsSync.createReadStream;
    const originalRename = fs.rename;
    let completedMinhashRereads = 0;
    fsSync.createReadStream = function(file, ...args) {
      if (['minhash_signatures.packed.bin', 'minhash_signatures.packed.meta.json'].includes(path.basename(String(file)))) {
        completedMinhashRereads++;
      }
      return originalCreateReadStream.call(this, file, ...args);
    };
    if (scenario.failMeta) {
      fs.rename = async function(from, to) {
        if (String(to) === path.join(outDir, 'minhash_signatures.packed.meta.json')) {
          const error = new Error('injected MinHash metadata commit failure');
          error.code = 'EIO';
          throw error;
        }
        return originalRename.call(this, from, to);
      };
    }
    try {
      const publication = writeIndexArtifacts({
        outDir, mode: 'code', state, postings, postingsConfig,
        modelId: 'stub', useStubEmbeddings: true, dictSummary: null,
        timing: { start: Date.now() }, root: testRoot,
        userConfig: { indexing: { scm: { provider: 'none' }, artifacts: {
          minhashJsonLargeThreshold: scenario.packedOnly ? 1 : 1000
        } } },
        incrementalEnabled: false, fileCounts: { candidates: scenario.count },
        perfProfile: null, indexState, graphRelations: null, stageCheckpoints: null
      });
      if (scenario.failMeta) await assert.rejects(publication, /injected MinHash metadata commit failure/);
      else await publication;
    } finally {
      fsSync.createReadStream = originalCreateReadStream;
      fs.rename = originalRename;
    }
    assert.equal(completedMinhashRereads, 0, 'manifest must reuse committed MinHash checksums without rereading files');
    if (scenario.failMeta) {
      assert.ok(await readOptional(path.join(outDir, 'minhash_signatures.packed.bin')), 'binary write must precede failed metadata commit');
      assert.equal(await readOptional(path.join(outDir, 'minhash_signatures.packed.meta.json')), null);
      assert.equal(await readOptional(path.join(outDir, 'pieces', 'manifest.json')), null,
        'failed metadata commit must not publish a manifest or its precomputed checksum');
      continue;
    }
    const json = await readOptional(path.join(outDir, 'minhash_signatures.json'), true);
    const meta = await readOptional(path.join(outDir, 'minhash_signatures.packed.meta.json'), true);
    const bytes = await readOptional(path.join(outDir, 'minhash_signatures.packed.bin'));
    captures.push({
      bytes,
      json: json ? { signatures: json.signatures, sampling: json.sampling } : null,
      meta: meta ? { dims: meta.dims, count: meta.count, checksum: meta.checksum, sampling: meta.sampling } : null,
      guard: indexState.extensions.minhashGuard
    });
    if (streaming) assert.equal(postings.minhashSigs.length, 0);
    if (scenario.count) {
      assert.ok(bytes, 'active writer must publish packed signatures');
      assert.equal(meta.count, scenario.count);
      assert.equal(json === null, scenario.packedOnly);
      const pieces = loadPiecesManifestPieces(outDir);
      for (const filename of ['minhash_signatures.packed.bin', 'minhash_signatures.packed.meta.json']) {
        const published = await fs.readFile(path.join(outDir, filename));
        const piece = pieces.find((entry) => entry.path === filename);
        assert.ok(piece, `missing committed piece: ${filename}`);
        assert.equal(piece.bytes, published.length);
        assert.equal(piece.checksum, `sha1:${crypto.createHash('sha1').update(published).digest('hex')}`);
      }
    }
  }
  if (scenario.failMeta) console.log('minhash metadata commit failure stayed unpublished');
  else {
    assert.deepEqual(captures[1], captures[0], 'active writer publication must preserve bytes, metadata and guards');
    console.log(`minhash writer parity ${caseIndex + 1}/4 passed`);
  }
}
console.log('sampled/ordinary/empty/packed-only MinHash publication passed');
