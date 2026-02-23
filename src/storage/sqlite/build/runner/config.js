import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteJson } from '../../../../shared/io/atomic-write.js';
import { sha1 } from '../../../../shared/hash.js';

const SQLITE_ZERO_STATE_SCHEMA_VERSION = '1.0.0';
const SQLITE_ZERO_STATE_MANIFEST_FILE = 'sqlite-zero-state.json';
const SQLITE_BUNDLE_WORKER_PROFILE_SCHEMA_VERSION = '1.0.0';
const SQLITE_BUNDLE_WORKER_PROFILE_FILE = 'bundle-worker-autotune.json';

export const BUNDLE_LOADER_WORKER_PATH = fileURLToPath(new URL('../bundle-loader-worker.js', import.meta.url));

export const resolveSqliteBundleWorkerProfilePath = (repoCacheRoot) => (
  repoCacheRoot
    ? path.join(repoCacheRoot, 'sqlite', SQLITE_BUNDLE_WORKER_PROFILE_FILE)
    : null
);

export const loadSqliteBundleWorkerProfile = async (repoCacheRoot) => {
  const profilePath = resolveSqliteBundleWorkerProfilePath(repoCacheRoot);
  if (!profilePath) {
    return {
      profilePath: null,
      profile: { schemaVersion: SQLITE_BUNDLE_WORKER_PROFILE_SCHEMA_VERSION, updatedAt: null, modes: {} }
    };
  }
  try {
    const raw = JSON.parse(await fs.readFile(profilePath, 'utf8'));
    const modes = raw?.modes && typeof raw.modes === 'object' ? raw.modes : {};
    return {
      profilePath,
      profile: {
        schemaVersion: SQLITE_BUNDLE_WORKER_PROFILE_SCHEMA_VERSION,
        updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : null,
        modes
      }
    };
  } catch {
    return {
      profilePath,
      profile: { schemaVersion: SQLITE_BUNDLE_WORKER_PROFILE_SCHEMA_VERSION, updatedAt: null, modes: {} }
    };
  }
};

export const saveSqliteBundleWorkerProfile = async ({ profilePath, profile }) => {
  if (!profilePath || !profile || typeof profile !== 'object') return;
  const payload = {
    schemaVersion: SQLITE_BUNDLE_WORKER_PROFILE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    modes: profile.modes && typeof profile.modes === 'object' ? profile.modes : {}
  };
  await fs.mkdir(path.dirname(profilePath), { recursive: true });
  await atomicWriteJson(profilePath, payload, { spaces: 2 });
};

export const resolveSqliteZeroStateManifestPath = (modeIndexDir) => (
  modeIndexDir ? path.join(modeIndexDir, 'pieces', SQLITE_ZERO_STATE_MANIFEST_FILE) : null
);

export const writeSqliteZeroStateManifest = async ({
  modeIndexDir,
  mode,
  outputPath,
  chunkCount,
  denseCount
}) => {
  const manifestPath = resolveSqliteZeroStateManifestPath(modeIndexDir);
  if (!manifestPath) return null;
  const payload = {
    schemaVersion: SQLITE_ZERO_STATE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode,
    outputPath: outputPath || null,
    chunkCount: Number.isFinite(Number(chunkCount)) ? Number(chunkCount) : 0,
    denseCount: Number.isFinite(Number(denseCount)) ? Number(denseCount) : 0
  };
  payload.checksum = sha1(JSON.stringify(payload));
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await atomicWriteJson(manifestPath, payload, { spaces: 2 });
  return manifestPath;
};
