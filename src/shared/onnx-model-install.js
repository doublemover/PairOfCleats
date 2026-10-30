import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoSymlinkPath, withContainedFile } from './contained-file.js';
import { createContainedFileResource } from './contained-file-resource.js';
import { observeEmbeddingOwnership, preserveEmbeddingCleanupFailure } from './embedding-cache-lifetime.js';
import { throwIfAborted } from './abort.js';
import { addStorageFailureContext } from './storage/operation-error.js';
import { readExactAt } from './io/read-exact.js';
import { atomicWriteJson } from './io/atomic-write.js';
import { syncParentDirectory, WINDOWS_PATH_BUDGET } from './io/persistence-helpers.js';
import { withFileLock } from './locks/file-lock.js';
import { fingerprintOnnxFile, planOnnxArtifactClosure } from './onnx-artifact-closure.js';
import { ONNX_INSTALLATION_RECEIPT, ONNX_INSTALLATION_VERSION, onnxSelectionPath, resolveInstalledOnnxPath } from './onnx-installation.js';

// ORT can load a namespaced graph but its relative external-data validator
// canonicalizes back to an ordinary Windows path. Keep those selected paths
// within the existing native path budget before publishing availability.
const overlongExternalPath = (root, plan) => process.platform === 'win32' && plan.files.some(row => row.path !== plan.graph)
  ? plan.files.find(row => path.join(root, ...row.path.split('/')).length > WINDOWS_PATH_BUDGET) : null;

const copyAsset = async (row, stage, signal) => {
  throwIfAborted(signal);
  const target = path.join(stage, ...row.path.split('/'));
  await fs.mkdir(path.dirname(target), { recursive: true });
  assertNoSymlinkPath(stage, target, { allowMissing: true });
  const sourceRoot = path.dirname(row.source);
  await withContainedFile(sourceRoot, row.source, async source => {
    const before = await source.stat();
    if (before.size !== row.bytes) throw new Error('Selected source size changed before model staging.');
    const handle = await fs.open(target, 'wx');
    const destination = createContainedFileResource({ handle, sync: false, additionalMethods: ['write', 'sync'] });
    await destination.run(async output => {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      for (let offset = 0; offset < row.bytes;) {
        throwIfAborted(signal);
        const read = await readExactAt(source, buffer, 0, Math.min(buffer.length, row.bytes - offset), offset);
        if (!read.bytesRead) throw new Error('Model source was truncated during staging.');
        for (let written = 0; written < read.bytesRead;) {
          throwIfAborted(signal);
          const progress = await output.write(buffer, written, read.bytesRead - written, offset + written);
          if (!Number.isSafeInteger(progress.bytesWritten) || progress.bytesWritten <= 0 || progress.bytesWritten > read.bytesRead - written) throw new Error('Model staging returned invalid write progress.');
          written += progress.bytesWritten;
        }
        offset += read.bytesRead;
      }
      source.verify();
      const after = await source.stat();
      if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => before[key] !== after[key])) {
        throw new Error('Selected model source changed while staging.');
      }
      await output.sync();
    });
  });
  const copied = await fingerprintOnnxFile(stage, target, { signal });
  if (copied.bytes !== row.bytes || copied.sha256 !== row.sha256) throw new Error('Staged model bytes differ from the verified source closure.');
};

/** Publish a closed immutable closure through the shared atomic file owner.
 * Existing graph files and selected generations are never overwritten or
 * deleted, so active readers keep their complete prior installation. */
export const installOnnxArtifactClosure = async ({ sourceGraph, targetGraph, hooks = {}, signal = null }) => {
  throwIfAborted(signal);
  sourceGraph = path.resolve(sourceGraph); targetGraph = path.resolve(targetGraph);
  const parent = path.dirname(targetGraph), graphName = path.basename(targetGraph);
  await fs.mkdir(parent, { recursive: true });
  const assets = `${targetGraph}.assets`;
  assertNoSymlinkPath(parent, assets, { allowMissing: true });
  await fs.mkdir(assets, { recursive: true });
  return withFileLock({ lockPath: path.join(assets, 'install.lock'), waitMs: 5000,
    timeoutBehavior: 'throw', metadata: { scope: 'onnx-artifact-install' }, signal }, async () => {
    const plan = await planOnnxArtifactClosure(sourceGraph, graphName, { signal });
    try {
      const selected = resolveInstalledOnnxPath(targetGraph) || targetGraph;
      const current = await planOnnxArtifactClosure(selected, graphName, { signal });
      if (current.digest === plan.digest && !overlongExternalPath(path.dirname(selected), current)) {
        return { graphPath: selected, digest: plan.digest, unchanged: true };
      }
    } catch (error) {
      const observe = observeEmbeddingOwnership(error);
      if (['EACCES', 'EPERM', 'ERR_UNSAFE_FILE_PATH', 'ABORT_ERR'].includes(error?.code) || observe && !observe()) throw error;
      // A partial legacy destination or interrupted selector is repairable by
      // publishing a new installation, without modifying the damaged bytes.
    }
    const stage = path.join(assets, `.staging-${randomUUID()}`);
    // The opaque directory token owns an immutable generation; full content
    // identity is independently verified in both selector and closure receipt.
    // Repeating the digest here costs native path space without adding proof.
    const generation = randomUUID().replaceAll('-', '');
    const final = path.join(assets, generation);
    const overlong = overlongExternalPath(final, plan);
    if (overlong) throw Object.assign(new Error('Selected ONNX target exceeds the Windows native path budget for declared external data; choose a shallower target.'), {
      code: 'ERR_ONNX_NATIVE_PATH_LIMIT', modelTarget: targetGraph, nativePathMember: overlong.path,
      nativePathMemberKind: overlong.path === plan.graph ? 'graph' : 'external-data',
      nativePathLimit: WINDOWS_PATH_BUDGET
    });
    await fs.mkdir(stage);
    let stageOwned = true;
    let failure, failed = false;
    try {
      for (const row of plan.files) {
        await copyAsset(row, stage, signal);
        await hooks.afterAsset?.(row.path);
        throwIfAborted(signal);
      }
      const stagedPlan = await planOnnxArtifactClosure(path.join(stage, graphName), graphName, { signal });
      if (stagedPlan.digest !== plan.digest) throw new Error('Staged ONNX closure identity changed.');
      const receipt = { version: ONNX_INSTALLATION_VERSION, graph: graphName, digest: plan.digest,
        files: plan.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })) };
      if (Buffer.byteLength(JSON.stringify(receipt)) > 64 * 1024) throw new Error('Model closure receipt exceeds its byte bound.');
      await atomicWriteJson(path.join(stage, ONNX_INSTALLATION_RECEIPT), receipt, { durable: true, signal });
      throwIfAborted(signal);
      await fs.rename(stage, final);
      stageOwned = false;
      await syncParentDirectory(final);
      await hooks.beforeSelection?.({ graphPath: path.join(final, graphName), digest: plan.digest });
      throwIfAborted(signal);
      const relativeGraph = `${path.basename(assets)}/${generation}/${graphName}`;
      await atomicWriteJson(onnxSelectionPath(targetGraph), { version: ONNX_INSTALLATION_VERSION,
        digest: plan.digest, graph: relativeGraph }, { durable: true, signal });
      const graphPath = resolveInstalledOnnxPath(targetGraph);
      if (!graphPath) throw new Error('Model publication has no verified selected graph.');
      return { graphPath, digest: plan.digest, unchanged: false };
    } catch (error) {
      failed = true; failure = error;
      throw error;
    } finally {
      if (stageOwned) {
        const observe = failed ? observeEmbeddingOwnership(failure) : null;
        // Unknown original native work keeps the exact staging tree and writer
        // lock. Retry must reconcile that resource owner before new publication.
        if (!observe || observe()) {
          try { assertNoSymlinkPath(assets, stage); await fs.rm(stage, { recursive: true, force: true }); }
          catch (error) { throw failed ? preserveEmbeddingCleanupFailure(failure, error) : error; }
        } else throw addStorageFailureContext(failure, { stagingPath: stage, modelTarget: targetGraph });
      }
    }
  });
};
