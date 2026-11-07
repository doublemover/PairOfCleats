import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { replaceDir, replaceFile, createTempPath } from './atomic.js';
import { copyFileWithDurability } from '../../../src/shared/io/persistence-helpers.js';
import { withFileLock } from '../../../src/shared/locks/file-lock.js';
import { assertNoSymlinkPath, readContainedFile } from '../../../src/shared/contained-file.js';
import { resolveHnswPaths } from '../../../src/shared/hnsw.js';
import { assertLanceDbPayload, resolveLanceDbPaths } from '../../../src/shared/lancedb.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

const variants = ['merged', 'doc', 'code'];
const prefix = variant => variant === 'merged' ? 'dense_vectors' : `dense_vectors_${variant}`;

const exists = async file => {
  try { await fs.lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
const publicationLock = metaPath => ({ lockPath: `${metaPath}.publication.lock`, waitMs: 10000,
  timeoutBehavior: 'throw', metadata: { scope: 'lancedb-publication' } });

const recoverLanceDbReplacementUnlocked = async ({ dir, metaPath }) => {
  const root = path.dirname(metaPath), journalPath = `${metaPath}.publication.json`;
  if (!(await exists(journalPath))) return;
  const record = JSON.parse((await readContainedFile(root, journalPath, { maxBytes: 65536 })).toString('utf8'));
  const child = (value, expectedPrefix) => {
    if (typeof value !== 'string' || path.basename(value) !== value || value.includes('\\')
      || !value.startsWith(expectedPrefix)) throw new Error(`Invalid LanceDB publication recovery path: ${value}`);
    return path.join(root, value);
  };
  if (record.version !== 1 || record.dir !== path.basename(dir) || record.meta !== path.basename(metaPath)
    || !/^[a-f0-9-]{36}$/.test(record.id || '') || typeof record.oldDirectory !== 'boolean'
    || typeof record.oldMetadata !== 'boolean') throw new Error('Invalid LanceDB publication recovery record.');
  const stageRoot = child(record.stageRoot, '.lancedb-staging-');
  if (record.stageRoot !== `.lancedb-staging-${record.id}`) {
    throw new Error('LanceDB recovery stage does not match its publication identity.');
  }
  const backupPath = record.backupPath ? child(record.backupPath, `.${path.basename(dir)}.bak-`) : null;
  for (const target of [dir, metaPath, stageRoot, backupPath].filter(Boolean)) {
    assertNoSymlinkPath(root, target, { allowMissing: true });
  }
  let committed = false;
  try {
    const meta = JSON.parse((await readContainedFile(root, metaPath, { maxBytes: 1024 * 1024 })).toString('utf8'));
    if (meta.extensions?.lancePublicationId === record.id) {
      assertLanceDbPayload(dir, { table: meta.table, count: meta.count });
      committed = true;
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  if (!committed) {
    const previousMeta = path.join(stageRoot, 'previous.meta.json');
    assertNoSymlinkPath(root, previousMeta, { allowMissing: true });
    if (record.oldMetadata && !(await exists(previousMeta))) {
      throw new Error(`LanceDB recovery requires retained metadata: ${previousMeta}`);
    }
    if (backupPath && await exists(backupPath)) {
      // The journal already retains the prior directory. Replacing the failed,
      // uncommitted output must not create a second unrecorded backup during
      // recovery; a failed rename leaves the original journal-owned copy intact.
      await fs.rm(dir, { recursive: true, force: true });
      await fs.rename(backupPath, dir);
    }
    else if (record.oldDirectory && !(await exists(dir))) {
      throw new Error(`LanceDB recovery cannot find the prior directory; retained descriptor: ${journalPath}`);
    }
    else if (!record.oldDirectory && !(await exists(path.join(stageRoot, path.basename(dir))))) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    if (record.oldMetadata) {
      const restored = createTempPath(metaPath);
      await copyFileWithDurability(previousMeta, restored);
      await replaceFile(restored, metaPath);
    }
  }
  if (backupPath) await fs.rm(backupPath, { recursive: true, force: true });
  await fs.rm(stageRoot, { recursive: true, force: true });
  await fs.rm(journalPath, { force: true });
};

/** Recover a previously interrupted fixed-path writer under its publication lease. */
export const recoverLanceDbReplacement = async input => withFileLock(publicationLock(input.metaPath),
  () => recoverLanceDbReplacementUnlocked(input));

/** Stage the complete pair before replacing a legacy fixed-path LanceDB target.
 * The journal owns the prior directory until the metadata commit identifies this
 * publication; interruption is recovered before the next replacement starts.
 */
export const publishLanceDbReplacement = async ({ dir, metaPath, stageRoot, stagedMetaPath, id }) => (
  withFileLock(publicationLock(metaPath), async () => {
    await recoverLanceDbReplacementUnlocked({ dir, metaPath });
    const root = path.dirname(metaPath), journalPath = `${metaPath}.publication.json`;
    if (path.dirname(dir) !== root || path.dirname(stageRoot) !== root
      || path.basename(stageRoot) !== `.lancedb-staging-${id}`
      || stagedMetaPath !== path.join(stageRoot, path.basename(metaPath))) {
      throw new Error('Invalid LanceDB publication paths.');
    }
    for (const target of [dir, metaPath, stageRoot, stagedMetaPath]) {
      assertNoSymlinkPath(root, target, { allowMissing: true });
    }
    const oldDirectory = await exists(dir), oldMetadata = await exists(metaPath);
    if (oldMetadata) await copyFileWithDurability(metaPath, path.join(stageRoot, 'previous.meta.json'));
    let journalWritten = false;
    try {
      await replaceDir(path.join(stageRoot, path.basename(dir)), dir, { keepBackup: true,
        onBeforePromote: async ({ backupPath }) => {
          await writeJsonObjectFile(journalPath, { atomic: true, fields: {
            version: 1, id, dir: path.basename(dir), meta: path.basename(metaPath),
            stageRoot: path.basename(stageRoot), backupPath: backupPath ? path.basename(backupPath) : null,
            oldDirectory, oldMetadata
          } });
          journalWritten = true;
        } });
      await replaceFile(stagedMetaPath, metaPath);
    } catch (error) {
      if (journalWritten) {
        try { await recoverLanceDbReplacementUnlocked({ dir, metaPath }); }
        catch (recoveryError) {
          throw new AggregateError([error, recoveryError], `LanceDB publication failed; recovery retained at ${journalPath}`,
            { cause: error });
        }
      }
      throw error;
    }
    try { await recoverLanceDbReplacementUnlocked({ dir, metaPath }); }
    catch (error) {
      // Metadata is the commit point. Keep the explicit recovery descriptor for
      // retryable cleanup and report it separately from successful publication.
      return { committed: true, cleanupError: error.message, recoveryPath: journalPath };
    }
    return { committed: true };
  })
);

/** Only completed writer receipts and complete output pairs enter an immutable
 * generation. The caller publishes its manifest after this rename succeeds.
 * Old generations remain untouched, including on interrupted promotion. */
export const publishBackendGeneration = async ({
  stageDir, indexDir, embeddingIdentity, embeddingGeneration, results, enabled, warn
}) => {
  if (!/^[a-f0-9]{64}$/.test(embeddingGeneration)) throw new Error('Invalid embedding generation.');
  const relativeDir = `.embeddings-backends/${embeddingGeneration}-${randomUUID()}`;
  const pieces = [];
  const backends = { hnsw: {}, lancedb: {} };
  for (const backend of ['hnsw', 'lancedb']) {
    for (const variant of variants) {
      const receipt = results?.[backend]?.[variant];
      const paths = backend === 'hnsw'
        ? resolveHnswPaths(stageDir, variant) : resolveLanceDbPaths(stageDir)[variant];
      const dataPath = paths.indexPath || paths.dir;
      const state = { enabled: enabled[backend] === true, available: false, target: variant };
      backends[backend][variant] = state;
      let admitted = false;
      if (state.enabled && receipt?.skipped === false && Number(receipt.count) > 0) {
        try {
          const [stat, raw] = await Promise.all([fs.lstat(dataPath), fs.readFile(paths.metaPath, 'utf8')]);
          const meta = JSON.parse(raw);
          if (backend === 'lancedb') assertLanceDbPayload(dataPath, { table: meta.table, count: meta.count });
          if (stat.isSymbolicLink() || (backend === 'hnsw' ? !stat.isFile() || stat.size === 0 : !stat.isDirectory())) {
            throw new Error('backend output has an invalid type');
          }
          if (Number(meta.count) !== Number(receipt.count) || Number(meta.dims) !== embeddingIdentity.dims
            || meta.model !== embeddingIdentity.modelId) throw new Error('backend output does not match its writer receipt');
          await writeJsonObjectFile(paths.metaPath, { fields: { ...meta, embeddingIdentity,
            embeddingGeneration, backendGeneration: relativeDir, variant }, atomic: true });
          Object.assign(state, { available: true, dims: meta.dims, count: meta.count,
            embeddingGeneration, backendGeneration: relativeDir });
          const name = `${prefix(variant)}_${backend}`;
          pieces.push({ type: 'embeddings', name, format: backend === 'hnsw' ? 'bin' : 'dir',
            path: `${relativeDir}/${path.basename(dataPath)}`, count: meta.count, dims: meta.dims });
          pieces.push({ type: 'embeddings', name: `${name}_meta`, format: 'json',
            path: `${relativeDir}/${path.basename(paths.metaPath)}`, count: meta.count, dims: meta.dims });
          admitted = true;
        } catch (error) {
          warn(`[embeddings] ${backend}/${variant}: replacement unavailable: ${error.message}`);
        }
      }
      if (!admitted) {
        // Remove only this invocation's rejected staging output, never an active generation.
        await fs.rm(dataPath, { recursive: backend === 'lancedb', force: true });
        await fs.rm(paths.metaPath, { force: true });
      }
    }
  }
  if (pieces.length) {
    const target = path.join(indexDir, relativeDir);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Same-volume rename: no partially copied generation becomes manifest-visible.
    try { await fs.rename(stageDir, target); }
    catch (error) {
      throw addStorageFailureContext(error, { backendPublication: {
        phase: 'same-volume-generation-rename', source: stageDir, destination: target,
        sourcePathLength: stageDir.length, destinationPathLength: target.length,
        availableVariants: Object.fromEntries(Object.entries(backends).map(([name, variants]) =>
          [name, Object.entries(variants).filter(([, state]) => state.available).map(([variant]) => variant)]))
      } });
    }
  }
  return { pieces, backends };
};
