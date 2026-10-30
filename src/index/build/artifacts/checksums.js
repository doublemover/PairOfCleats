import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../../shared/progress-runtime.js';
import { runWithSettledConcurrency } from '../../../shared/concurrency/run-with-queue.js';
import { coerceAbortSignal, throwIfAborted } from '../../../shared/abort.js';
import { checksumFileObservation } from '../../../shared/hash.js';
import { writeJsonObjectFile } from '../../../shared/json-stream/json-writers.js';
import { resolveArtifactPath } from '../../../shared/artifact-io/contained-path.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { withGeneratedArtifactMetadata } from '../../../shared/generated-artifact-core.js';
import { withIndexStatePublicationLock } from '../../../shared/index-state-publication.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { runInitialIndexStatePublication } from './index-state-publication.js';

const writePiecesManifestLocked = async ({
  pieceEntries,
  outDir,
  mode,
  indexState,
  abortSignal = null
}) => {
  if (!pieceEntries.length) return;
  const effectiveAbortSignal = coerceAbortSignal(abortSignal);
  throwIfAborted(effectiveAbortSignal);
  const sortedEntries = pieceEntries
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : (a.path > b.path ? 1 : 0)));
  const piecesDir = path.join(outDir, 'pieces');
  await fs.mkdir(piecesDir, { recursive: true });
  const manifestPath = path.join(piecesDir, 'manifest.json');
  const normalizedEntries = await runWithSettledConcurrency(
    sortedEntries,
    Math.min(4, sortedEntries.length),
    async (entry) => {
      throwIfAborted(effectiveAbortSignal);
      const absPath = resolveArtifactPath(outDir, entry.path);
      if (entry.bytes != null && (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0)) throw new Error(`Pieces manifest invalid sealed size for ${entry.path}`);
      let bytes = entry.bytes ?? null;
      let checksum = null;
      let checksumAlgo = null;
      let statError = null;
      let checksumError = null;
      let stat = null;
      try {
        stat = await fs.stat(absPath);
      } catch (err) {
        throw observeStorageResource(err, { phase: 'pieces-manifest-stat' })
          .wrap(new Error(`Pieces manifest failed to stat ${entry.path}`, { cause: err }));
      }
      if (!Number.isFinite(bytes)) {
        bytes = stat.size;
      } else if (bytes !== stat.size) {
        throw new Error(`Pieces manifest sealed size mismatch for ${entry.path}`);
      }
      if (typeof entry?.checksum === 'string' && entry.checksum.includes(':')) {
        const [algo, value] = entry.checksum.split(':');
        if (algo && value) {
          checksumAlgo = String(algo).trim().toLowerCase();
          checksum = String(value).trim().toLowerCase();
        }
      }
      if (!checksum || !checksumAlgo || entry.path === 'index_state.json' || entry.name === 'index_state') {
        try {
          const result = await checksumFileObservation(absPath, { containedRoot: outDir, signal: effectiveAbortSignal, nativeMetadata: true });
          if (entry.bytes != null && entry.bytes !== result.bytes) throw new Error(`Pieces manifest sealed size mismatch for ${entry.path}`);
          bytes = result.bytes;
          checksum = result?.value || null;
          checksumAlgo = result?.algo || null;
        } catch (err) {
          throw observeStorageResource(err, { phase: 'pieces-manifest-checksum' })
            .wrap(new Error(`Pieces manifest failed to checksum ${entry.path}`, { cause: err }));
        }
      }
      if (!checksum || !checksumAlgo) {
        throw new Error(`Pieces manifest missing checksum for ${entry.path}`);
      }
      return {
        ...entry,
        bytes,
        checksum: checksum && checksumAlgo ? `${checksumAlgo}:${checksum}` : null,
        statError: statError || null,
        checksumError: checksumError || null
      };
    },
    {
      signal: effectiveAbortSignal,
      collectResults: true
    }
  );
  await writeJsonObjectFile(manifestPath, {
    fields: withGeneratedArtifactMetadata({
      version: 2,
      artifactSurfaceVersion: indexState?.artifactSurfaceVersion || ARTIFACT_SURFACE_VERSION,
      compatibilityKey: indexState?.compatibilityKey || null,
      generatedAt: new Date().toISOString(),
      mode,
      stage: indexState?.stage || null,
      repoId: indexState?.repoId || null,
      buildId: indexState?.buildId || null,
      pieces: normalizedEntries
    }, 'pieces-manifest'),
    atomic: true
  });
  log(`→ Wrote pieces manifest (${normalizedEntries.length} entries).`, {
    fileOnlyLine: `→ Wrote pieces manifest (${normalizedEntries.length} entries) at ${manifestPath}.`
  });
};

export const writePiecesManifest = async ({ indexStatePublication = null, ...options }) => {
  observeStorageResource(options.pieceEntries, { phase: 'pieces-manifest-input' }).requireSettled();
  for (const entry of options.pieceEntries) observeStorageResource(entry, { phase: 'pieces-manifest-input-entry' }).requireSettled();
  const signal = coerceAbortSignal(options.abortSignal);
  if (!options.pieceEntries.length) { throwIfAborted(signal); return; }
  observeStorageResource(options.indexState, { phase: 'pieces-manifest-input-state' }).requireSettled();
  const requested = structuredClone({ outDir: options.outDir, mode: options.mode, pieceEntries: options.pieceEntries,
    indexState: options.indexState ? Object.fromEntries(['artifactSurfaceVersion', 'compatibilityKey', 'stage', 'repoId', 'buildId']
      .map(key => [key, options.indexState[key]])) : null });
  const action = () => writePiecesManifestLocked({ ...requested, abortSignal: signal });
  return indexStatePublication === null ? withIndexStatePublicationLock(requested.outDir, action, { signal })
    : runInitialIndexStatePublication(indexStatePublication, requested.outDir, action, { signal });
};
