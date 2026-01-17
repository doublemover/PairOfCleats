import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../../shared/progress.js';
import { runWithConcurrency } from '../../../shared/concurrency.js';
import { checksumFile } from '../../../shared/hash.js';
import { writeJsonObjectFile } from '../../../shared/json-stream.js';

export const writePiecesManifest = async ({
  pieceEntries,
  outDir,
  mode,
  indexState
}) => {
  if (!pieceEntries.length) return;
  const piecesDir = path.join(outDir, 'pieces');
  await fs.mkdir(piecesDir, { recursive: true });
  const manifestPath = path.join(piecesDir, 'manifest.json');
  const normalizedEntries = await runWithConcurrency(
    pieceEntries,
    Math.min(4, pieceEntries.length),
    async (entry) => {
      const absPath = path.join(outDir, entry.path.split('/').join(path.sep));
      let bytes = null;
      let checksum = null;
      let checksumAlgo = null;
      let statError = null;
      let checksumError = null;
      try {
        const stat = await fs.stat(absPath);
        bytes = stat.size;
      } catch (err) {
        statError = err?.message || String(err);
      }
      if (!statError) {
        try {
          const result = await checksumFile(absPath);
          checksum = result?.value || null;
          checksumAlgo = result?.algo || null;
        } catch (err) {
          checksumError = err?.message || String(err);
        }
      }
      if (statError || checksumError) {
        const parts = [
          statError ? `stat=${statError}` : null,
          checksumError ? `checksum=${checksumError}` : null
        ].filter(Boolean);
        log(`[pieces] Failed to read checksum for ${entry.path}: ${parts.join(', ')}`);
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
      generatedAt: new Date().toISOString(),
      mode,
      stage: indexState?.stage || null,
      pieces: normalizedEntries
    },
    atomic: true
  });
  log(`→ Wrote pieces manifest (${normalizedEntries.length} entries).`);
};
