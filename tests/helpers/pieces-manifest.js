import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPiecesManifest } from '../../src/shared/artifact-io/manifest.js';
import { readJsonFile } from '../../src/shared/artifact-io/json.js';

export const resolvePiecesManifestPath = (indexDir) => path.join(indexDir, 'pieces', 'manifest.json');

const toManifestFields = (raw) => {
  if (!raw || typeof raw !== 'object') return {};
  return raw.fields && typeof raw.fields === 'object' ? raw.fields : raw;
};

const ensurePieces = (manifest) => {
  if (!Array.isArray(manifest.pieces)) manifest.pieces = [];
  return manifest.pieces;
};

export const loadPiecesManifestFields = (indexDir, options = {}) => {
  const manifest = loadPiecesManifest(indexDir, options);
  if (!manifest) return null;
  const fields = { ...manifest };
  fields.pieces = Array.isArray(fields.pieces) ? fields.pieces : [];
  return fields;
};

export const loadPiecesManifestPieces = (indexDir, options = {}) => {
  const manifest = loadPiecesManifestFields(indexDir, options);
  return manifest ? manifest.pieces : [];
};

export const updatePiecesManifest = async (
  indexDir,
  mutator,
  { maxBytes } = {}
) => {
  const manifestPath = resolvePiecesManifestPath(indexDir);
  const parsed = readJsonFile(
    manifestPath,
    Number.isFinite(maxBytes) ? { maxBytes } : undefined
  );
  const raw = parsed && typeof parsed === 'object' ? parsed : {};
  const target = toManifestFields(raw);
  ensurePieces(target);
  await mutator(target, { manifestPath, raw });
  await fs.writeFile(manifestPath, JSON.stringify(raw, null, 2));
  return target;
};
