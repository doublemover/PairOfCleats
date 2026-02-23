import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareTestCacheDir } from './test-cache.js';

const toManifestPath = (value) => String(value || '').replace(/\\/g, '/');

export const prepareArtifactIoTestDir = async (name, { root = process.cwd() } = {}) => {
  const { dir: testRoot } = await prepareTestCacheDir(name, { root });
  await fs.mkdir(path.join(testRoot, 'pieces'), { recursive: true });
  return testRoot;
};

export const writePiecesManifest = async (
  dir,
  pieces,
  { compatibilityKey = 'test-compat' } = {}
) => {
  const manifestPath = path.join(dir, 'pieces', 'manifest.json');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const normalizedPieces = Array.isArray(pieces)
    ? pieces.map((piece) => ({
      ...piece,
      path: toManifestPath(piece?.path)
    }))
    : [];
  const manifest = {
    compatibilityKey,
    pieces: normalizedPieces
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
};
