import path from 'node:path';
import crypto from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { resolveArtifactPath } from '../../shared/artifact-io/contained-path.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { sha256File } from '../../shared/hash.js';
import { throwIfAborted } from '../../shared/abort.js';
import { stableStringifyForSignature } from '../../shared/stable-json.js';
import { assertIndexCacheLease } from './cache-lease.js';
import { assertArtifactPublicationReady, resolveArtifactPublicationPath } from './artifact-publication.js';

const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_PUBLICATION_BYTES = 1024 * 1024;
const MODES = new Set(['code', 'prose', 'extracted-prose', 'records']);
const digest = value => crypto.createHash('sha256').update(stableStringifyForSignature(value)).digest('hex');
const fail = message => Object.assign(new Error(message), { code: 'ERR_COMPLETED_STAGE_INVALID' });
const samePath = (left, right) => path.relative(path.resolve(left), path.resolve(right)) === '';

export const readBuildMetadata = async (root, filename, maxBytes = MAX_PUBLICATION_BYTES) => {
  const { buffer, hash } = await readVerifiedContainedFile(root, filename, { maxBytes });
  return { value: JSON.parse(buffer.toString('utf8')), hash };
};

/** Hash only the manifest-owned output. Unknown/unlisted bytes are never reuse authority. */
const inventory = async ({ buildRoot, buildId, mode, signal }) => {
  if (!MODES.has(mode)) throw fail('Unsupported completed-stage mode.');
  const outDir = path.join(buildRoot, `index-${mode}`);
  const manifestPath = path.join(outDir, 'pieces', 'manifest.json');
  const { value: manifest, hash: manifestHash } = await readBuildMetadata(outDir, manifestPath, MAX_MANIFEST_BYTES);
  if (manifest?.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION || manifest.mode !== mode
    || manifest.buildId !== buildId || !Array.isArray(manifest.pieces) || !manifest.pieces.length
    || manifest.pieces.length > 200000) throw fail('Completed-stage manifest has unknown identity or inventory.');
  const names = new Set();
  const rows = [];
  let bytes = 0;
  for (const piece of manifest.pieces) {
    throwIfAborted(signal);
    if (typeof piece?.path !== 'string' || names.has(piece.path)
      || !Number.isSafeInteger(piece.bytes) || piece.bytes < 0) throw fail('Invalid completed-stage piece.');
    names.add(piece.path);
    const filename = resolveArtifactPath(outDir, piece.path);
    // The contained descriptor owner verifies extent/identity and closes before returning.
    const hash = await sha256File(filename, { containedRoot: outDir, signal });
    bytes += piece.bytes;
    if (!Number.isSafeInteger(bytes)) throw fail('Completed-stage byte total exceeds safe integer range.');
    rows.push({ path: piece.path, bytes: piece.bytes, hash });
  }
  rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { manifestHash, contentHash: digest(rows), pieces: rows.length, bytes };
};

/** Extend the existing published mode authority after its writers have drained.
 * This receipt survives later optional-stage failure. It does not make mutable
 * mode files an immutable graph snapshot, or authorize normal current selection.
 */
export const sealCompletedStage = async ({ runtime, mode, sourceSnapshot = null, dependencySignatures = null, signal = null }) => {
  assertIndexCacheLease(runtime.cacheWriterLease, runtime.repoCacheRoot);
  throwIfAborted(signal);
  await assertArtifactPublicationReady({ buildRoot: runtime.buildRoot, modes: [mode] });
  const filename = resolveArtifactPublicationPath(runtime.buildRoot, mode);
  const { value: publication } = await readBuildMetadata(runtime.buildRoot, filename);
  const output = await inventory({ buildRoot: runtime.buildRoot, buildId: runtime.buildId, mode, signal });
  const completedStage = {
    schemaVersion: 1, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    stage: 'stage2', mode, buildId: runtime.buildId,
    buildRoot: path.resolve(runtime.buildRoot), repoRoot: path.resolve(runtime.root),
    originatingAttemptId: runtime.runtimeAttempt?.attemptId || null,
    sealedAt: new Date().toISOString(), configHash: runtime.configHash || null,
    profile: runtime.profile || null, sourceSnapshot, dependencySignatures,
    output, semanticSnapshot: 'not-independently-pinned',
    reuseAuthority: 'exact-retained-bytes-only'
  };
  await atomicWriteJson(filename, { ...publication, completedStage }, { spaces: 2, newline: true, signal,
    beforeCommit: () => assertIndexCacheLease(runtime.cacheWriterLease, runtime.repoCacheRoot) });
  return completedStage;
};

/** Historical validation rehashes exact bytes; marker presence cannot authorize it. */
export const verifyCompletedStage = async ({ buildRoot, buildId, repoRoot, mode, signal = null }) => {
  throwIfAborted(signal);
  await assertArtifactPublicationReady({ buildRoot, modes: [mode] });
  const { value: publication } = await readBuildMetadata(buildRoot, resolveArtifactPublicationPath(buildRoot, mode));
  const receipt = publication.completedStage;
  if (receipt?.schemaVersion !== 1 || receipt.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION
    || receipt.buildId !== buildId || receipt.mode !== mode || receipt.stage !== 'stage2'
    || !samePath(receipt.buildRoot || '.', buildRoot)
    || !samePath(receipt.repoRoot || '.', repoRoot)
    || receipt.reuseAuthority !== 'exact-retained-bytes-only') throw fail('No valid exact-generation completion receipt.');
  const output = await inventory({ buildRoot, buildId, mode, signal });
  if (digest(output) !== digest(receipt.output)) throw fail('Retained Stage2 content differs from its seal.');
  return receipt;
};
