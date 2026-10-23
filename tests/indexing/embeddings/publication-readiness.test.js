#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { publishEmbeddingGeneration } from '../../../tools/build/embeddings/publication.js';
import { updatePieceManifest } from '../../../tools/build/embeddings/manifest.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { checksumFile } from '../../../src/shared/hash.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('embedding-publication-readiness');
const statePath = path.join(dir, 'index_state.json');
const manifestPath = path.join(dir, 'pieces/manifest.json');
await fs.mkdir(path.dirname(manifestPath), { recursive: true });
const persisted = async () => JSON.parse(await fs.readFile(statePath, 'utf8'));
try {
  for (const fault of ['manifest', 'validation-throw', 'validation-invalid', 'receipt', null]) {
    await fs.writeFile(manifestPath, JSON.stringify({ version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      pieces: [{ name: 'index_state', type: 'stats', format: 'json', path: 'index_state.json' }] }));
    let receipts = 0;
    const indexState = { embeddings: { ready: true, pending: false, embeddingGeneration: 'test-generation' } };
    const assertPending = async () => {
      const state = await persisted();
      assert.equal(state.embeddings.ready, false);
      assert.equal(state.embeddings.pending, true);
    };
    const run = () => publishEmbeddingGeneration({ statePath, indexState,
      publishManifest: async () => {
        await assertPending();
        if (fault === 'manifest') throw new Error('manifest fault');
        await updatePieceManifest({ indexDir: dir, mode: 'code', totalChunks: 0, dims: 2 });
      },
      validate: async () => {
        await assertPending();
        assert.equal(receipts, 0, 'receipt readiness follows validation');
        if (fault === 'validation-throw') throw new Error('validation fault');
        return { ok: fault !== 'validation-invalid' };
      },
      commitReceipt: async () => {
        await assertPending();
        if (fault === 'receipt') throw new Error('receipt fault');
        receipts++;
      }
    });
    if (fault && fault !== 'validation-invalid') await assert.rejects(run(), /fault/);
    else assert.equal((await run()).ok, fault === null);
    if (fault) await assertPending();
    else {
      assert.equal((await persisted()).embeddings.ready, true);
      assert.equal((await persisted()).embeddings.pending, false);
      assert.equal(receipts, 1);
      const statePiece = JSON.parse(await fs.readFile(manifestPath, 'utf8')).pieces.find(piece => piece.name === 'index_state');
      const checksum = await checksumFile(statePath);
      assert.equal(statePiece.checksum, `${checksum.algo}:${checksum.value}`);
    }
  }
  for (const abortAt of ['manifest', 'validation', 'receipt']) {
    const controller = new AbortController();
    const abort = phase => { if (abortAt === phase) controller.abort(); };
    const indexState = { embeddings: { ready: true, pending: false } };
    await assert.rejects(publishEmbeddingGeneration({ statePath, indexState, signal: controller.signal,
      publishManifest: async () => { abort('manifest'); },
      validate: async () => { abort('validation'); return { ok: true }; },
      commitReceipt: async () => { abort('receipt'); }
    }), error => error.name === 'AbortError' || error.code === 'ABORT_ERR');
    assert.equal((await persisted()).embeddings.ready, false);
    assert.equal((await persisted()).embeddings.pending, true);
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Embedding publication stays pending through manifest, validation and receipt fault boundaries.');
