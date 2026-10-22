import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoSymlinkPath, openContainedFile, verifyContainedFileHandle } from './contained-file.js';
import { readExactAt } from './io/read-exact.js';
import { atomicWriteJson } from './io/atomic-write.js';
import { syncParentDirectory } from './io/persistence-helpers.js';
import { withFileLock } from './locks/file-lock.js';
import { fingerprintOnnxFile, planOnnxArtifactClosure } from './onnx-artifact-closure.js';
import { ONNX_INSTALLATION_RECEIPT, ONNX_INSTALLATION_VERSION, onnxSelectionPath, resolveInstalledOnnxPath } from './onnx-installation.js';

const copyAsset = async (row, stage) => {
  const target = path.join(stage, ...row.path.split('/'));
  await fs.mkdir(path.dirname(target), { recursive: true });
  assertNoSymlinkPath(stage, target, { allowMissing: true });
  const sourceRoot = path.dirname(row.source);
  const source = await openContainedFile(sourceRoot, row.source);
  let destination;
  let failure;
  try {
    destination = await fs.open(target, 'wx');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (let offset = 0; offset < row.bytes;) {
      const read = await readExactAt(source, buffer, 0, Math.min(buffer.length, row.bytes - offset), offset);
      if (!read.bytesRead) throw new Error('Model source was truncated during staging.');
      for (let written = 0; written < read.bytesRead;) {
        const progress = await destination.write(buffer, written, read.bytesRead - written, offset + written);
        if (!Number.isSafeInteger(progress.bytesWritten) || progress.bytesWritten <= 0 || progress.bytesWritten > read.bytesRead - written) throw new Error('Model staging returned invalid write progress.');
        written += progress.bytesWritten;
      }
      offset += read.bytesRead;
    }
    verifyContainedFileHandle(source, sourceRoot, row.source);
    await destination.sync();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    for (const handle of [destination, source]) {
      try { await handle?.close(); } catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length) {
      if (failure) failure.cleanupErrors = [...(failure.cleanupErrors || []), ...cleanupErrors];
      else throw new AggregateError(cleanupErrors, 'Model staging handles could not be closed.');
    }
  }
  const copied = await fingerprintOnnxFile(stage, target);
  if (copied.bytes !== row.bytes || copied.sha256 !== row.sha256) throw new Error('Staged model bytes differ from the verified source closure.');
};

/** Publish a closed immutable closure through the shared atomic file owner.
 * Existing graph files and selected generations are never overwritten or
 * deleted, so active readers keep their complete prior installation. */
export const installOnnxArtifactClosure = async ({ sourceGraph, targetGraph, hooks = {} }) => {
  sourceGraph = path.resolve(sourceGraph); targetGraph = path.resolve(targetGraph);
  const parent = path.dirname(targetGraph), graphName = path.basename(targetGraph);
  await fs.mkdir(parent, { recursive: true });
  const assets = `${targetGraph}.assets`;
  assertNoSymlinkPath(parent, assets, { allowMissing: true });
  await fs.mkdir(assets, { recursive: true });
  return withFileLock({ lockPath: path.join(assets, 'install.lock'), waitMs: 5000,
    timeoutBehavior: 'throw', metadata: { scope: 'onnx-artifact-install' } }, async () => {
    const plan = await planOnnxArtifactClosure(sourceGraph, graphName);
    try {
      const selected = resolveInstalledOnnxPath(targetGraph) || targetGraph;
      const current = await planOnnxArtifactClosure(selected, graphName);
      if (current.digest === plan.digest) return { graphPath: selected, digest: plan.digest, unchanged: true };
    } catch (error) {
      if (['EACCES', 'EPERM', 'ERR_UNSAFE_FILE_PATH'].includes(error.code)) throw error;
      // A partial legacy destination or interrupted selector is repairable by
      // publishing a new installation, without modifying the damaged bytes.
    }
    const stage = path.join(assets, `.staging-${randomUUID()}`);
    const generation = `${plan.digest}-${randomUUID()}`;
    const final = path.join(assets, generation);
    await fs.mkdir(stage);
    let stageOwned = true;
    let failure;
    try {
      for (const row of plan.files) {
        await copyAsset(row, stage);
        await hooks.afterAsset?.(row.path);
      }
      const stagedPlan = await planOnnxArtifactClosure(path.join(stage, graphName), graphName);
      if (stagedPlan.digest !== plan.digest) throw new Error('Staged ONNX closure identity changed.');
      const receipt = { version: ONNX_INSTALLATION_VERSION, graph: graphName, digest: plan.digest,
        files: plan.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })) };
      if (Buffer.byteLength(JSON.stringify(receipt)) > 64 * 1024) throw new Error('Model closure receipt exceeds its byte bound.');
      await atomicWriteJson(path.join(stage, ONNX_INSTALLATION_RECEIPT), receipt, { durable: true });
      await fs.rename(stage, final);
      stageOwned = false;
      await syncParentDirectory(final);
      await hooks.beforeSelection?.({ graphPath: path.join(final, graphName), digest: plan.digest });
      const relativeGraph = `${path.basename(assets)}/${generation}/${graphName}`;
      await atomicWriteJson(onnxSelectionPath(targetGraph), { version: ONNX_INSTALLATION_VERSION,
        digest: plan.digest, graph: relativeGraph }, { durable: true });
      const graphPath = resolveInstalledOnnxPath(targetGraph);
      if (!graphPath) throw new Error('Model publication has no verified selected graph.');
      return { graphPath, digest: plan.digest, unchanged: false };
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      if (stageOwned) {
        try { await fs.rm(stage, { recursive: true, force: true }); }
        catch (error) {
          if (failure) failure.cleanupErrors = [...(failure.cleanupErrors || []), error];
          else throw error;
        }
      }
    }
  });
};
