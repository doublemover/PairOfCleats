import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../../shared/contained-file.js';
import { atomicWriteJson, atomicWriteText } from '../../shared/io/atomic-write.js';
import { resolveArtifactPath } from '../../shared/artifact-io/contained-path.js';
import { throwIfAborted } from '../../shared/abort.js';
import { assertIndexCacheLease } from './cache-lease.js';
import { assertArtifactPublicationReady, resolveArtifactPublicationPath,
  writeArtifactPublicationRecord, writeArtifactPublicationValidationReport } from './artifact-publication.js';
import { reconcileIndexIdentity } from '../identity/reconcile.js';
import { GRAPH_CAPABILITY_REQUIRED_FAMILIES, writeGraphCapabilityReceipt } from './graph-capability.js';
import { copyStageMember, inventoryStageOutput, readBuildMetadata, sameStagePath,
  stageFailure, stageIdentityHash, STAGE_METADATA_MAX_BYTES } from './stage-output.js';

export const resolveStageSnapshotRoot = (buildRoot, locator) => {
  if (!locator || typeof locator.relativeRoot !== 'string' || !/^completed\/(code|prose|extracted-prose|records)\/[a-f0-9-]{36}$/.test(locator.relativeRoot)) {
    throw stageFailure('Invalid immutable stage snapshot locator.');
  }
  const snapshotRoot = resolveArtifactPath(buildRoot, locator.relativeRoot);
  assertNoSymlinkPath(buildRoot, snapshotRoot);
  return snapshotRoot;
};

/** Snapshots are ordinary contained generation copies using the same family
 * validation/publication owners. Only the final descriptor exposes a copy;
 * interrupted copies remain unsealed and are never candidate authority.
 */
export const snapshotStageOutput = async ({ runtime, mode, manifest, inventory, output, completion, signal, graphOnly = false }) => {
  const assertOwned = () => assertIndexCacheLease(runtime.cacheWriterLease, runtime.repoCacheRoot);
  assertOwned(); throwIfAborted(signal);
  const relativeRoot = `completed/${mode}/${randomUUID()}`;
  const snapshotRoot = resolveArtifactPath(runtime.buildRoot, relativeRoot);
  assertNoSymlinkPath(runtime.buildRoot, snapshotRoot, { allowMissing: true });
  await fs.mkdir(path.join(snapshotRoot, `index-${mode}`), { recursive: true });
  const sourceRoot = path.join(runtime.buildRoot, `index-${mode}`), targetRoot = path.join(snapshotRoot, `index-${mode}`);
  for (const part of inventory) await copyStageMember({ sourceRoot, targetRoot, part, signal, assertOwned });
  const manifestPath = path.join(targetRoot, 'pieces/manifest.json');
  const original = await readVerifiedContainedFile(sourceRoot, path.join(sourceRoot, 'pieces/manifest.json'), {
    maxBytes: STAGE_METADATA_MAX_BYTES, expectedHash: output.manifestHash, signal
  });
  const selectedPaths = new Set(inventory.map(part => part.path));
  const selectedManifest = graphOnly ? { ...manifest, pieces: manifest.pieces.filter(piece => selectedPaths.has(piece.path)) } : manifest;
  if (graphOnly) await atomicWriteJson(manifestPath, selectedManifest, { signal, createOnly: true, beforeCommit: assertOwned });
  else await atomicWriteText(manifestPath, original.buffer, { signal, createOnly: true, beforeCommit: assertOwned });
  const families = graphOnly ? [{ family: 'graph-capability', owner: 'build-graph-capability',
    requiredMembers: GRAPH_CAPABILITY_REQUIRED_FAMILIES }] : completion?.publicationFamilies || [];
  const publicationValidation = await writeArtifactPublicationValidationReport({ buildRoot: snapshotRoot, outDir: targetRoot,
    mode, buildId: runtime.buildId, pieceEntries: selectedManifest.pieces, manifestPath, familyDeclarations: families });
  if (!publicationValidation.payload.ok) throw stageFailure('Immutable stage snapshot family validation failed.');
  const identity = mode === 'code' ? await reconcileIndexIdentity({ indexDir: targetRoot, strict: true }) : null;
  if (identity && !identity.ok) throw stageFailure('Immutable stage snapshot identities disagree.');
  await writeArtifactPublicationRecord({ buildRoot: snapshotRoot, outDir: targetRoot, mode, stage: 'stage2',
    buildId: runtime.buildId, pieceEntries: selectedManifest.pieces, manifestPath, publicationValidation,
    identityReconciliation: identity, cleanup: { status: 'not-required', plannedActions: 0, completedActions: 0, failedActions: 0, failures: [] } });
  const snapshotOutput = graphOnly ? (await inventoryStageOutput({ buildRoot: snapshotRoot, buildId: runtime.buildId, mode, signal })).output : output;
  const descriptor = { schemaVersion: 1, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, mode,
    repoRoot: path.resolve(runtime.root), sourceBuildRoot: path.resolve(runtime.buildRoot), buildId: runtime.buildId,
    snapshotRoot: path.resolve(snapshotRoot), completion, output: snapshotOutput, inventory };
  const encoded = JSON.stringify(descriptor);
  if (Buffer.byteLength(encoded) > STAGE_METADATA_MAX_BYTES) throw stageFailure('Immutable stage descriptor exceeds its metadata allowance.');
  const descriptorHash = stageIdentityHash(descriptor);
  let graphCapability = null;
  if (mode === 'code') {
    try {
      graphCapability = await writeGraphCapabilityReceipt({ root: runtime.root, sourceBuildRoot: runtime.buildRoot,
        indexRoot: snapshotRoot, buildId: runtime.buildId, manifest: selectedManifest, descriptorHash, signal, assertOwned });
    } catch (error) {
      if (error.code !== 'ERR_GRAPH_CAPABILITY_VALIDATION') throw error;
      graphCapability = { status: 'unavailable', reason: error.message };
    }
  }
  // The graph receipt cannot be opened until this descriptor is committed too.
  await atomicWriteJson(path.join(snapshotRoot, 'stage-completion.json'), descriptor, {
    signal, createOnly: true, beforeCommit: assertOwned
  });
  return { schemaVersion: 1, relativeRoot, descriptorHash, graphCapability: graphCapability
    ? { status: graphCapability.status, capabilityId: graphCapability.capabilityId || null,
      reason: graphCapability.reason || null } : null };
};

export const verifyStageSnapshot = async ({ buildRoot, buildId, repoRoot, mode, locator, signal }) => {
  throwIfAborted(signal);
  const snapshotRoot = resolveStageSnapshotRoot(buildRoot, locator);
  const { value: descriptor } = await readBuildMetadata(snapshotRoot, path.join(snapshotRoot, 'stage-completion.json'), STAGE_METADATA_MAX_BYTES, signal);
  if (descriptor.schemaVersion !== 1 || descriptor.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION
    || descriptor.mode !== mode || descriptor.buildId !== buildId || stageIdentityHash(descriptor) !== locator.descriptorHash
    || !sameStagePath(descriptor.repoRoot, repoRoot) || !sameStagePath(descriptor.sourceBuildRoot, buildRoot)
    || !sameStagePath(descriptor.snapshotRoot, snapshotRoot) || !Array.isArray(descriptor.inventory)) {
    throw stageFailure('Immutable stage descriptor belongs to another generation or policy.');
  }
  const actual = await inventoryStageOutput({ buildRoot: snapshotRoot, buildId, mode, signal });
  if (stageIdentityHash(actual.output) !== stageIdentityHash(descriptor.output)
    || stageIdentityHash(actual.inventory) !== stageIdentityHash(descriptor.inventory)) throw stageFailure('Immutable stage snapshot content changed.');
  await assertArtifactPublicationReady({ buildRoot: snapshotRoot, modes: [mode] });
  return { snapshotRoot, descriptor, manifest: actual.manifest };
};

/** Restore the same generation's original bytes; semantic base/revision are
 * preserved rather than relabeled as a new generation. Publication is rebuilt.
 */
export const restoreStageSnapshot = async ({ runtime, mode, receipt, signal }) => {
  const verified = await verifyStageSnapshot({ buildRoot: runtime.buildRoot, buildId: runtime.buildId,
    repoRoot: runtime.root, mode, locator: receipt.snapshot, signal });
  const assertOwned = () => assertIndexCacheLease(runtime.cacheWriterLease, runtime.repoCacheRoot);
  const sourceRoot = path.join(verified.snapshotRoot, `index-${mode}`), targetRoot = path.join(runtime.buildRoot, `index-${mode}`);
  await fs.mkdir(targetRoot, { recursive: true });
  for (const part of verified.descriptor.inventory) await copyStageMember({ sourceRoot, targetRoot, part, signal, assertOwned, createOnly: false });
  const { buffer } = await readVerifiedContainedFile(sourceRoot, path.join(sourceRoot, 'pieces/manifest.json'), {
    maxBytes: STAGE_METADATA_MAX_BYTES, expectedHash: verified.descriptor.output.manifestHash, signal });
  await atomicWriteText(path.join(targetRoot, 'pieces/manifest.json'), buffer, { signal, beforeCommit: assertOwned });
  const publicationValidation = await writeArtifactPublicationValidationReport({ buildRoot: runtime.buildRoot, outDir: targetRoot,
    mode, buildId: runtime.buildId, pieceEntries: verified.manifest.pieces,
    familyDeclarations: verified.descriptor.completion.publicationFamilies || [] });
  if (!publicationValidation.payload.ok) throw stageFailure('Restored stage family validation failed.');
  const identityReconciliation = mode === 'code' ? await reconcileIndexIdentity({ indexDir: targetRoot, strict: true }) : null;
  if (identityReconciliation && !identityReconciliation.ok) throw stageFailure('Restored stage identity validation failed.');
  await writeArtifactPublicationRecord({ buildRoot: runtime.buildRoot, outDir: targetRoot, mode, stage: 'stage2', buildId: runtime.buildId,
    pieceEntries: verified.manifest.pieces, publicationValidation, identityReconciliation });
  const publicationPath = resolveArtifactPublicationPath(runtime.buildRoot, mode);
  const { value: publication } = await readBuildMetadata(runtime.buildRoot, publicationPath);
  await atomicWriteJson(publicationPath, { ...publication, completedStage: receipt }, { signal, beforeCommit: assertOwned });
  return { restoredPieces: verified.descriptor.inventory.length, copiedBytes: verified.descriptor.output.bytes };
};
