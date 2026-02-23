import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson } from '../../../../shared/io/atomic-write.js';

const MODALITY_SPARSITY_SCHEMA_VERSION = '1.0.0';
const MODALITY_SPARSITY_PROFILE_FILE = 'modality-sparsity-profile.json';
const MODALITY_SPARSITY_MAX_ENTRIES = 512;

const createEmptyModalitySparsityProfile = () => ({
  schemaVersion: MODALITY_SPARSITY_SCHEMA_VERSION,
  updatedAt: null,
  entries: {}
});

/**
 * Resolve per-repo modality sparsity profile artifact path.
 *
 * @param {object} runtime
 * @returns {string|null}
 */
export const resolveModalitySparsityProfilePath = (runtime) => {
  const repoCacheRoot = typeof runtime?.repoCacheRoot === 'string' ? runtime.repoCacheRoot : '';
  if (!repoCacheRoot) return null;
  return path.join(repoCacheRoot, MODALITY_SPARSITY_PROFILE_FILE);
};

/**
 * Build stable key for modality sparsity profile entries.
 *
 * @param {{mode:string,cacheSignature:string}} input
 * @returns {string}
 */
export const buildModalitySparsityEntryKey = ({ mode, cacheSignature }) => (
  `${String(mode || 'unknown')}:${String(cacheSignature || 'nosig')}`
);

const normalizeModalitySparsityProfile = (profile) => {
  if (!profile || typeof profile !== 'object') return createEmptyModalitySparsityProfile();
  const entries = profile.entries && typeof profile.entries === 'object' ? profile.entries : {};
  return {
    schemaVersion: typeof profile.schemaVersion === 'string'
      ? profile.schemaVersion
      : MODALITY_SPARSITY_SCHEMA_VERSION,
    updatedAt: typeof profile.updatedAt === 'string' ? profile.updatedAt : null,
    entries
  };
};

/**
 * Read modality sparsity profile from disk (or return empty profile).
 *
 * @param {object} runtime
 * @returns {Promise<{profilePath:string|null,profile:object}>}
 */
export const readModalitySparsityProfile = async (runtime) => {
  const profilePath = resolveModalitySparsityProfilePath(runtime);
  if (!profilePath) {
    return { profilePath: null, profile: createEmptyModalitySparsityProfile() };
  }
  try {
    const raw = await fs.readFile(profilePath, 'utf8');
    const parsed = normalizeModalitySparsityProfile(JSON.parse(raw));
    return { profilePath, profile: parsed };
  } catch {
    return { profilePath, profile: createEmptyModalitySparsityProfile() };
  }
};

const trimModalitySparsityEntries = (entries = {}) => {
  const list = Object.entries(entries);
  if (list.length <= MODALITY_SPARSITY_MAX_ENTRIES) return entries;
  list.sort((a, b) => {
    const aTs = Date.parse(a?.[1]?.updatedAt || 0) || 0;
    const bTs = Date.parse(b?.[1]?.updatedAt || 0) || 0;
    return bTs - aTs;
  });
  const keep = list.slice(0, MODALITY_SPARSITY_MAX_ENTRIES);
  return Object.fromEntries(keep);
};

/**
 * Upsert one modality sparsity observation and persist profile atomically.
 *
 * @param {{
 *  runtime:object,
 *  profilePath:string|null,
 *  profile:object,
 *  mode:string,
 *  cacheSignature:string,
 *  fileCount:number,
 *  chunkCount:number,
 *  elided:boolean,
 *  source:string
 * }} input
 * @returns {Promise<void>}
 */
export const writeModalitySparsityEntry = async ({
  runtime,
  profilePath,
  profile,
  mode,
  cacheSignature,
  fileCount,
  chunkCount,
  elided,
  source
}) => {
  if (!profilePath) return;
  const now = new Date().toISOString();
  const key = buildModalitySparsityEntryKey({ mode, cacheSignature });
  const next = normalizeModalitySparsityProfile(profile);
  next.updatedAt = now;
  next.entries = {
    ...next.entries,
    [key]: {
      schemaVersion: MODALITY_SPARSITY_SCHEMA_VERSION,
      key,
      mode,
      cacheSignature: cacheSignature || null,
      fileCount: Number.isFinite(Number(fileCount)) ? Number(fileCount) : 0,
      chunkCount: Number.isFinite(Number(chunkCount)) ? Number(chunkCount) : 0,
      elided: elided === true,
      source: source || null,
      repoRoot: runtime?.root || null,
      updatedAt: now
    }
  };
  next.entries = trimModalitySparsityEntries(next.entries);
  await fs.mkdir(path.dirname(profilePath), { recursive: true });
  await atomicWriteJson(profilePath, next, { spaces: 2 });
};

/**
 * Determine whether stage processing can be elided for empty modality.
 *
 * @param {{fileCount:number,chunkCount:number}} input
 * @returns {boolean}
 */
export const shouldElideModalityProcessingStage = ({ fileCount, chunkCount }) => (
  Number(fileCount) === 0 && Number(chunkCount) === 0
);
