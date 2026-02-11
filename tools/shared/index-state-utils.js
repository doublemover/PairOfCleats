import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES, readJsonFile } from '../../src/shared/artifact-io.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { checksumFile } from '../../src/shared/hash.js';

/**
 * Update the index_state entry in the manifest with fresh size/checksum metadata.
 * @param {string} indexDir
 * @returns {Promise<void>}
 */
export const updateIndexStateManifest = async (indexDir) => {
  const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
  if (!fsSync.existsSync(manifestPath)) return;
  let manifest = null;
  try {
    manifest = readJsonFile(manifestPath, { maxBytes: MAX_JSON_BYTES }) || null;
  } catch {
    return;
  }
  if (!manifest || !Array.isArray(manifest.pieces)) return;
  const statePath = path.join(indexDir, 'index_state.json');
  if (!fsSync.existsSync(statePath)) return;
  const targetIndex = manifest.pieces.findIndex((piece) => (
    (piece?.path === 'index_state.json')
    || (piece?.name === 'index_state')
  ));
  if (targetIndex < 0) return;
  let bytes = null;
  let checksum = null;
  let checksumAlgo = null;
  try {
    const stat = await fs.stat(statePath);
    bytes = stat.size;
    const result = await checksumFile(statePath);
    checksum = result?.value || null;
    checksumAlgo = result?.algo || null;
  } catch {}
  if (!Number.isFinite(Number(bytes)) || Number(bytes) < 0 || !checksum) return;
  const nextChecksum = checksum && checksumAlgo ? `${checksumAlgo}:${checksum}` : null;
  const current = manifest.pieces[targetIndex] || {};
  if (current.path === 'index_state.json'
    && Number(current.bytes) === Number(bytes)
    && String(current.checksum || '') === String(nextChecksum || '')) {
    return;
  }
  const pieces = [...manifest.pieces];
  pieces[targetIndex] = {
    ...current,
    path: 'index_state.json',
    name: current.name || 'index_state',
    bytes,
    checksum: nextChecksum || current.checksum || null
  };
  const next = {
    ...manifest,
    updatedAt: new Date().toISOString(),
    pieces
  };
  try {
    await writeJsonObjectFile(manifestPath, { fields: next, atomic: true });
  } catch {
    // Ignore manifest write failures.
  }
};
