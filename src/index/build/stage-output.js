import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { assertNoSymlinkPath, readVerifiedContainedFile, withContainedFile } from '../../shared/contained-file.js';
import { resolveArtifactPath } from '../../shared/artifact-io/contained-path.js';
import { atomicWriteChunks } from '../../shared/io/atomic-write.js';
import { sha256File } from '../../shared/hash.js';
import { throwIfAborted } from '../../shared/abort.js';
import { stableStringifyForSignature } from '../../shared/stable-json.js';

export const STAGE_METADATA_MAX_BYTES = 32 * 1024 * 1024;
export const stageIdentityHash = value => crypto.createHash('sha256').update(stableStringifyForSignature(value)).digest('hex');
export const sameStagePath = (left, right) => path.relative(path.resolve(left), path.resolve(right)) === '';
export const stageFailure = message => Object.assign(new Error(message), { code: 'ERR_COMPLETED_STAGE_INVALID' });
export const readBuildMetadata = async (root, filename, maxBytes = 1024 * 1024, signal = null) => {
  const { buffer, hash } = await readVerifiedContainedFile(root, filename, { maxBytes, signal });
  return { value: JSON.parse(buffer.toString('utf8')), hash };
};

/** Exact manifest inventory, independent of directory names and mtimes. */
export const inventoryStageOutput = async ({ buildRoot, buildId, mode, signal, select = () => true }) => {
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
  for (const piece of manifest.pieces) {
    throwIfAborted(signal);
    if (typeof piece?.path !== 'string' || names.has(piece.path)
      || !Number.isSafeInteger(piece.bytes) || piece.bytes < 0) throw stageFailure('Invalid completed-stage piece.');
    names.add(piece.path);
    const filename = resolveArtifactPath(outDir, piece.path);
    if (!select(piece)) continue;
    const hash = await sha256File(filename, { containedRoot: outDir, signal });
    bytes += piece.bytes;
    if (!Number.isSafeInteger(bytes)) throw stageFailure('Completed-stage byte total exceeds safe integer range.');
    inventory.push({ path: piece.path, bytes: piece.bytes, hash });
  }
  inventory.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (Buffer.byteLength(JSON.stringify(inventory)) > STAGE_METADATA_MAX_BYTES) throw stageFailure('Completed-stage inventory exceeds its metadata allowance.');
  return { manifest, inventory, output: { manifestHash, contentHash: stageIdentityHash(inventory), pieces: inventory.length, bytes } };
};

/** Copy one admitted mode member through the existing contained reader and
 * durable atomic writer. The target is an owned generation, never a hardlink.
 */
export const copyStageMember = async ({ sourceRoot, targetRoot, part, signal, assertOwned, createOnly = true }) => {
  throwIfAborted(signal); assertOwned();
  const source = resolveArtifactPath(sourceRoot, part.path), target = resolveArtifactPath(targetRoot, part.path, { allowMissing: true });
  assertNoSymlinkPath(targetRoot, target, { allowMissing: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  await withContainedFile(sourceRoot, source, async descriptor => {
    const before = await descriptor.stat();
    if (!before.isFile() || before.size !== part.bytes) throw stageFailure('Sealed mode member changed size.');
    await atomicWriteChunks(target, async write => {
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
