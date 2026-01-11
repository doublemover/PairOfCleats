import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { readJson } from '../../src/storage/sqlite/utils.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { checksumFile } from '../../src/shared/hash.js';

export const updateIndexStateManifest = async (indexDir) => {
  const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
  if (!fsSync.existsSync(manifestPath)) return;
  let manifest = null;
  try {
    manifest = readJson(manifestPath) || null;
  } catch {
    return;
  }
  if (!manifest || !Array.isArray(manifest.pieces)) return;
  const statePath = path.join(indexDir, 'index_state.json');
  if (!fsSync.existsSync(statePath)) return;
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
  if (!bytes || !checksum) return;
  const pieces = manifest.pieces.map((piece) => {
    if (piece?.name !== 'index_state' || piece?.path !== 'index_state.json') {
      return piece;
    }
    return {
      ...piece,
      bytes,
      checksum: checksum && checksumAlgo ? `${checksumAlgo}:${checksum}` : piece.checksum
    };
  });
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

export const updateSqliteState = async (indexDir, patch) => {
  if (!indexDir) return;
  const statePath = path.join(indexDir, 'index_state.json');
  let state = {};
  if (fsSync.existsSync(statePath)) {
    try {
      state = readJson(statePath) || {};
    } catch {
      state = {};
    }
  }
  const now = new Date().toISOString();
  state.generatedAt = state.generatedAt || now;
  state.updatedAt = now;
  state.sqlite = {
    ...(state.sqlite || {}),
    ...patch,
    updatedAt: now
  };
  try {
    await writeJsonObjectFile(statePath, { fields: state, atomic: true });
  } catch {
    // Ignore index state write failures.
  }
  await updateIndexStateManifest(indexDir);
};
