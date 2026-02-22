import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../../shared/progress.js';
import { runWithConcurrency } from '../../../shared/concurrency.js';
import { checksumFile } from '../../../shared/hash.js';
import { writeJsonObjectFile } from '../../../shared/json-stream.js';
import { fromPosix } from '../../../shared/files.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';

export const writePiecesManifest = async ({
  pieceEntries,
  outDir,
  mode,
  indexState
}) => {
  if (!pieceEntries.length) return;
  const sortedEntries = pieceEntries
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : (a.path > b.path ? 1 : 0)));
  const piecesDir = path.join(outDir, 'pieces');
  await fs.mkdir(piecesDir, { recursive: true });
  const manifestPath = path.join(piecesDir, 'manifest.json');
  const normalizedEntries = await runWithConcurrency(
    sortedEntries,
    Math.min(4, sortedEntries.length),
    async (entry) => {
      const absPath = path.join(outDir, fromPosix(entry.path));
      let bytes = Number.isFinite(Number(entry?.bytes))
        ? Math.max(0, Number(entry.bytes))
        : null;
      let checksum = null;
      let checksumAlgo = null;
      let statError = null;
      let checksumError = null;
      let stat = null;
      try {
        stat = await fs.stat(absPath);
      } catch (err) {
        throw new Error(`Pieces manifest failed to stat ${entry.path}: ${err?.message || err}`);
      }
      if (!Number.isFinite(bytes)) {
        bytes = stat.size;
      }
      if (typeof entry?.checksum === 'string' && entry.checksum.includes(':')) {
        const [algo, value] = entry.checksum.split(':');
        if (algo && value) {
          checksumAlgo = String(algo).trim().toLowerCase();
          checksum = String(value).trim().toLowerCase();
        }
      }
      if (!checksum || !checksumAlgo) {
        try {
          const result = await checksumFile(absPath);
          checksum = result?.value || null;
          checksumAlgo = result?.algo || null;
        } catch (err) {
          throw new Error(`Pieces manifest failed to checksum ${entry.path}: ${err?.message || err}`);
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
    }
  );
  await writeJsonObjectFile(manifestPath, {
    fields: {
      version: 2,
      artifactSurfaceVersion: indexState?.artifactSurfaceVersion || ARTIFACT_SURFACE_VERSION,
      compatibilityKey: indexState?.compatibilityKey || null,
      generatedAt: new Date().toISOString(),
      mode,
      stage: indexState?.stage || null,
      repoId: indexState?.repoId || null,
      buildId: indexState?.buildId || null,
      pieces: normalizedEntries
    },
    atomic: true
  });
  log(`→ Wrote pieces manifest (${normalizedEntries.length} entries).`, {
    fileOnlyLine: `→ Wrote pieces manifest (${normalizedEntries.length} entries) at ${manifestPath}.`
  });
};
