import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadChunkMeta, loadTokenPostings } from '../../src/shared/artifact-io/loaders.js';
import { MAX_JSON_BYTES } from '../../src/shared/artifact-io/constants.js';
import { inventoryBackendPayload } from '../../src/shared/artifact-io/backend-payload-inventory.js';
import { assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';
import { withFileLock } from '../../src/shared/locks/file-lock.js';
import { throwIfAborted } from '../../src/shared/abort.js';
import { resolveTantivyPaths, TANTIVY_SCHEMA_VERSION } from '../../src/shared/tantivy.js';
import { createTantivySource, readTantivyManifest, tantivySourceKey, sameTantivySource } from '../../src/shared/tantivy-source.js';
import { readTantivyReceipt, TANTIVY_RECEIPT_MAX_BYTES } from '../../src/shared/tantivy-receipt.js';
import { withTantivyStorage } from '../../src/shared/tantivy-storage.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';

const pending = new Map();
const failure = message => Object.assign(new Error(message), { code: 'ERR_TANTIVY_PUBLICATION' });
const sourceChanged = () => failure('The selected Tantivy source changed during materialization or native build.');

/** Build only a private generation. The atomic receipt is the sole activation
 * point. Unreferenced generations are retained; neither this invocation nor a
 * reader can delete an earlier payload whose native handle may still be live.
 * The optional adapter must settle all writes before its build Promise returns. */
export const buildTantivyGeneration = async ({ repoRoot, indexDir, mode, config = {}, userConfig,
  buildIndex, signal = null, log = () => {} }) => {
  if (typeof buildIndex !== 'function') throw new TypeError('Tantivy requires an explicit native builder.');
  throwIfAborted(signal);
  for (const [task, observation] of pending) if (observation?.isSettled()) pending.delete(task);
  if (pending.size >= 16) throw failure('Tantivy build queue is full.');
  const task = Symbol('tantivy-build'); pending.set(task, null);
  let retained = null;
  try {
    const context = { repoRoot, userConfig, env: { ...process.env } };
    return await withTantivyStorage(indexDir, context, async () => {
      const selected = await readTantivyManifest(indexDir, { repoRoot, signal });
      const chunkMeta = await loadChunkMeta(indexDir, { maxBytes: MAX_JSON_BYTES, manifest: selected.manifest, strict: true });
      const tokenPostings = loadTokenPostings(indexDir, { maxBytes: MAX_JSON_BYTES, manifest: selected.manifest, strict: true });
      const sourceInput = { repoRoot, indexDir, mode, chunkMeta, tokenPostings, signal, manifestSha256: selected.sha256 };
      const source = await createTantivySource(sourceInput), sourceKey = tantivySourceKey(source);
      const unchanged = async ({ verifyInputs = false } = {}) => {
        throwIfAborted(signal);
        if ((await readTantivyManifest(indexDir, { repoRoot, signal })).sha256 !== selected.sha256
          || verifyInputs && !sameTantivySource(source, await createTantivySource(sourceInput))) throw sourceChanged();
      };
      await unchanged();
      const paths = resolveTantivyPaths(indexDir, mode, config);
      return withTantivyStorage(paths.dir, context, async () => {
        assertNoSymlinkPath(path.parse(paths.dir).root, paths.dir, { allowMissing: true });
        await fs.mkdir(paths.dir, { recursive: true });
        return withFileLock({ lockPath: path.join(paths.dir, 'writer.lock'), waitMs: 10000, signal,
          timeoutBehavior: 'throw', metadata: { sourceKey, mode, scope: 'tantivy-generation-writer' } }, async () => {
          await unchanged();
          const existing = await readTantivyReceipt({ indexDir, mode, config, source, signal });
          if (existing.available) return { ...existing, reused: true };
          const generations = path.join(paths.dir, 'generations');
          assertNoSymlinkPath(paths.dir, generations, { allowMissing: true });
          await fs.mkdir(generations, { recursive: true });
          const publicationId = randomUUID();
          // The UUID directory itself is the private staging target. It becomes
          // served only when its completed receipt is committed below.
          const dir = path.join(generations, publicationId);
          await fs.mkdir(dir);
          log(`[tantivy] Building ${mode} generation ${publicationId}...`);
          await Promise.resolve(buildIndex({ indexPath: dir, mode, vocab: tokenPostings.vocab,
            postings: tokenPostings.postings, docLengths: tokenPostings.docLengths,
            avgDocLen: tokenPostings.avgDocLen, totalDocs: tokenPostings.totalDocs, chunkMeta }));
          await unchanged({ verifyInputs: true });
          const inventory = await inventoryBackendPayload({ dir, signal });
          if (!inventory || !inventory.entries.some(row => row.kind === 'file')) throw failure('Tantivy returned no bounded completed native payload.');
          const meta = { schemaVersion: TANTIVY_SCHEMA_VERSION, mode, createdAt: new Date().toISOString(),
            publicationId, sourceKey, source, chunkCount: source.chunkCount, docCount: source.docCount,
            vocabCount: source.vocabCount, inventory };
          if (Buffer.byteLength(JSON.stringify(meta)) > TANTIVY_RECEIPT_MAX_BYTES) throw failure('Tantivy receipt exceeds its bounded admission size.');
          await unchanged();
          throwIfAborted(signal);
          await atomicWriteJson(paths.metaPath, meta, { signal });
          log(`[tantivy] Activated ${paths.metaPath}`);
          return { ...paths, dir, meta, available: true, reason: null, reused: false };
        });
      });
    });
  } catch (error) {
    const observation = observeStorageResource(error, { phase: 'tantivy-build-slot' });
    if (!observation.isSettled()) retained = observation;
    throw error;
  } finally {
    if (retained) pending.set(task, retained);
    else pending.delete(task);
  }
};
