import { runWithSettledConcurrency } from '../../shared/concurrency/run-with-queue.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { assertNoSymlinkPath, readVerifiedContainedFile, withContainedFile } from '../../shared/contained-file.js';
import { assertArtifactFilePath, resolveArtifactPath, resolveArtifactIdentityPath } from '../../shared/artifact-io/contained-path.js';
import { atomicWriteChunks } from '../../shared/io/atomic-write.js';
import { sha256File } from '../../shared/hash.js';
import { throwIfAborted } from '../../shared/abort.js';
import { stableStringifyForSignature } from '../../shared/stable-json.js';
import { createContainedFileResource } from '../../shared/contained-file-resource.js';
import { assertDirectoryIdentity, syncParentDirectory } from '../../shared/io/directory-sync.js';
import { persistenceFileIdentity, assertPersistenceFileIdentity } from '../../shared/io/file-identity.js';

export const STAGE_METADATA_MAX_BYTES = 32 * 1024 * 1024;
export const stageIdentityHash = value => crypto.createHash('sha256').update(stableStringifyForSignature(value)).digest('hex');
export const sameStagePath = (left, right) => path.relative(path.resolve(left), path.resolve(right)) === '';
export const stageFailure = message => Object.assign(new Error(message), { code: 'ERR_COMPLETED_STAGE_INVALID' });
export const readBuildMetadata = async (root, filename, maxBytes = 1024 * 1024, signal = null) => {
  const { buffer, hash } = await readVerifiedContainedFile(root, filename, { maxBytes, signal });
  return { value: JSON.parse(buffer.toString('utf8')), hash };
};

/** Exact manifest inventory, independent of directory names and mtimes. */
const inventoryStageOutputUsing = async ({ buildRoot, buildId, mode, signal, select = () => true }, copyWillVerifyHashes) => {
  if (!['code', 'prose', 'extracted-prose', 'records'].includes(mode)) throw stageFailure('Unsupported completed-stage mode.');
  const outDir = path.join(buildRoot, `index-${mode}`);
  const manifestPath = path.join(outDir, 'pieces/manifest.json');
  const { value: manifest, hash: manifestHash } = await readBuildMetadata(outDir, manifestPath, STAGE_METADATA_MAX_BYTES, signal);
  if (manifest?.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION || manifest.mode !== mode
    || manifest.buildId !== buildId || !Array.isArray(manifest.pieces) || manifest.pieces.length > 200000) {
    throw stageFailure('Completed-stage manifest has unknown identity or inventory.');
  }
  const names = new Set(), inventory = [];
  let bytes = 0;
  await runWithSettledConcurrency(manifest.pieces, 4, async piece => {
    throwIfAborted(signal);
    if (typeof piece?.path !== 'string' || names.has(piece.path)
      || !Number.isSafeInteger(piece.bytes) || piece.bytes < 0) throw stageFailure('Invalid completed-stage piece.');
    names.add(piece.path);
    const filename = resolveArtifactIdentityPath(outDir, piece.path);
    if (!select(piece)) { resolveArtifactPath(outDir, piece.path); return; }
    const pinned = copyWillVerifyHashes && typeof piece.checksum === 'string'
      ? /^sha256:([a-f0-9]{64})$/i.exec(piece.checksum) : null;
    // The unpublished copy checks this exact digest against its actual held
    // source bytes before any completion descriptor can be published. Ordinary
    // inventory/reuse verification still rehashes every physical member.
    const hash = pinned ? pinned[1].toLowerCase() : await sha256File(filename, { containedRoot: outDir, signal });
    bytes += piece.bytes;
    if (!Number.isSafeInteger(bytes)) throw stageFailure('Completed-stage byte total exceeds safe integer range.');
    inventory.push({ path: piece.path, bytes: piece.bytes, hash });
  }, { signal });
  inventory.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (Buffer.byteLength(JSON.stringify(inventory)) > STAGE_METADATA_MAX_BYTES) throw stageFailure('Completed-stage inventory exceeds its metadata allowance.');
  return { manifest, inventory, output: { manifestHash, contentHash: stageIdentityHash(inventory), pieces: inventory.length, bytes } };
};

export const inventoryStageOutput = options => inventoryStageOutputUsing(options, false);
export const inventoryStageOutputForCopy = options => inventoryStageOutputUsing(options, true);

/** Copy one admitted mode member through the existing contained reader and
 * durable atomic writer. The target is an owned generation, never a hardlink.
 */
const copyStageMemberUsing = async ({ sourceRoot, targetRoot, part, signal, assertOwned, createOnly = true }, writeChunks,
  resolveTarget = resolveArtifactPath) => {
  throwIfAborted(signal); assertOwned();
  // The contained reader admits the source at open, and the atomic writer
  // creates target parents before its existing lease/path commit recheck.
  const source = resolveArtifactIdentityPath(sourceRoot, part.path), target = resolveTarget(targetRoot, part.path, { allowMissing: true });
  await withContainedFile(sourceRoot, source, async descriptor => {
    const before = await descriptor.stat();
    if (!before.isFile() || before.size !== part.bytes) throw stageFailure('Sealed mode member changed size.');
    await writeChunks(target, async write => {
      const hash = crypto.createHash('sha256'), scratch = Buffer.allocUnsafe(Math.min(65536, Math.max(1, before.size)));
      let position = 0;
      while (position < before.size) {
        throwIfAborted(signal); assertOwned();
        const length = Math.min(scratch.length, before.size - position);
        const { bytesRead } = await descriptor.read(scratch, 0, length, position);
        if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > length) throw stageFailure('Sealed mode member made invalid read progress.');
        const bytes = scratch.subarray(0, bytesRead);
        hash.update(bytes); await write(bytes); position += bytesRead;
      }
      const after = await descriptor.stat(); descriptor.verify();
      if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => before[key] !== after[key])
        || hash.digest('hex') !== part.hash) throw stageFailure('Sealed mode member content changed during copy.');
    }, { signal, createOnly, beforeCommit: () => { assertOwned(); assertNoSymlinkPath(targetRoot, target, { allowMissing: true }); } });
  });
};

export const copyStageMember = options => copyStageMemberUsing(options, atomicWriteChunks);


/** Four bounded I/O copies retain at most four 64 KiB source buffers. Failure
 * stops admission; the existing queue drains every launched copy before the
 * batch exposes an error. The signal belongs to actual I/O, not a queue race
 * that could return while a source descriptor or atomic writer is still live.
 */
export const copyStageMembers = async ({ inventory, ...options }) =>
  runWithSettledConcurrency(inventory, 4, part => copyStageMember({ ...options, part }), { signal: options.signal });

/** Only a freshly allocated, unpublished snapshot may use this writer. Its
 * completion descriptor is the publication boundary. Members are exclusive
 * ordinary copies, synced and closed before directory sync and validation.
 * Failure leaves unsealed bytes for the existing generation recovery owner;
 * it never deletes a pathname while an original descriptor may remain live.
 * Restore/replacement continues to use the atomic member writer above.
 */
export const copyUnpublishedStageMembers = async ({ inventory, sourceRoot, targetRoot, signal, assertOwned }) => {
  const parents = new Map();
  for (const part of inventory) {
    throwIfAborted(signal);
    // Planning compares labels only. Each parent is admitted at creation below,
    // and each file is physically admitted by its writer at actual open/use.
    const target = resolveArtifactIdentityPath(targetRoot, part.path);
    if (!parents.has(path.dirname(target))) parents.set(path.dirname(target), { target, identity: null });
  }
  for (const [parent, entry] of parents) {
    throwIfAborted(signal); assertOwned();
    assertNoSymlinkPath(targetRoot, parent, { allowMissing: true });
    await fs.mkdir(parent, { recursive: true });
    assertNoSymlinkPath(targetRoot, parent);
    entry.identity = await fs.stat(parent, { bigint: true });
    assertDirectoryIdentity(entry.identity);
  }
  const writeChunks = async (target, produce, options) => {
    throwIfAborted(signal); assertOwned();
    assertArtifactFilePath(targetRoot, target, { allowMissing: true });
    const parent = parents.get(path.dirname(target));
    assertDirectoryIdentity(await fs.stat(path.dirname(target), { bigint: true }), parent.identity);
    const handle = await fs.open(target, 'wx');
    const owner = createContainedFileResource({ handle, sync: false, additionalMethods: ['write', 'sync'] });
    await owner.run(async descriptor => {
      const initial = persistenceFileIdentity(await descriptor.stat({ bigint: true }));
      if (initial.size !== '0') throw stageFailure('Unpublished stage member was not exclusively created empty.');
      assertArtifactFilePath(targetRoot, target);
      assertPersistenceFileIdentity(await fs.lstat(target, { bigint: true }), initial);
      let written = 0;
      const write = async bytes => {
        let offset = 0;
        while (offset < bytes.length) {
          throwIfAborted(signal);
          const { bytesWritten } = await descriptor.write(bytes, offset, bytes.length - offset, null);
          if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > bytes.length - offset) {
            throw stageFailure('Unpublished stage member made invalid write progress.');
          }
          offset += bytesWritten;
          written += bytesWritten;
        }
      };
      await produce(write);
      await descriptor.sync();
      await options.beforeCommit();
      const sealed = persistenceFileIdentity(await descriptor.stat({ bigint: true }));
      if (sealed.size !== String(written)
        || ['dev', 'ino', 'mode', 'birthtime'].some(key => initial[key] !== sealed[key])) {
        throw stageFailure('Unpublished stage member changed its original file identity.');
      }
      assertPersistenceFileIdentity(await fs.lstat(target, { bigint: true }), sealed);
      assertDirectoryIdentity(await fs.stat(path.dirname(target), { bigint: true }), parent.identity);
    });
  };
  await runWithSettledConcurrency(inventory, 4, part => copyStageMemberUsing({
    sourceRoot, targetRoot, part, signal, assertOwned, createOnly: true
  }, writeChunks, resolveArtifactIdentityPath), { signal });
  await runWithSettledConcurrency([...parents.values()], 4,
    async entry => { assertOwned(); await syncParentDirectory(entry.target, { expectedParent: entry.identity }); }, { signal });
};
