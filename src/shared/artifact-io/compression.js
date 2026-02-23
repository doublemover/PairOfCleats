import fs from 'node:fs';
import { gunzipSync, zstdDecompressSync as zstdDecompressSyncNative } from 'node:zlib';
import { getBakPath } from './cache.js';
import { shouldAbortForHeap, shouldTreatAsTooLarge, toJsonTooLargeError } from './limits.js';

const zstdDecompressSync = (buffer, maxBytes, sourcePath) => {
  try {
    const outputLimit = maxBytes > 0 ? maxBytes + 1024 : 0;
    const outBuffer = zstdDecompressSyncNative(
      buffer,
      outputLimit > 0 ? { maxOutputLength: outputLimit } : undefined
    );
    if (outBuffer.length > maxBytes || shouldAbortForHeap(outBuffer.length)) {
      throw toJsonTooLargeError(sourcePath, outBuffer.length);
    }
    return outBuffer;
  } catch (err) {
    if (shouldTreatAsTooLarge(err)) {
      throw toJsonTooLargeError(sourcePath, maxBytes);
    }
    const message = typeof err?.message === 'string' ? err.message : String(err);
    throw new Error(`zstd decompress failed: ${message}`);
  }
};

const gunzipWithLimit = (buffer, maxBytes, sourcePath) => {
  try {
    const limit = Number.isFinite(Number(maxBytes)) ? Math.max(0, Math.floor(Number(maxBytes))) : 0;
    const outputLimit = limit > 0 ? limit + 1024 : 0;
    return gunzipSync(buffer, outputLimit > 0 ? { maxOutputLength: outputLimit } : undefined);
  } catch (err) {
    if (shouldTreatAsTooLarge(err)) {
      throw toJsonTooLargeError(sourcePath, maxBytes);
    }
    throw err;
  }
};

const stripBak = (filePath) => (filePath.endsWith('.bak') ? filePath.slice(0, -4) : filePath);

export const ARTIFACT_COMPRESSION_TIERS = Object.freeze(['hot', 'warm', 'cold']);

const normalizeTierName = (value, fallback = 'warm') => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'hot' || normalized === 'warm' || normalized === 'cold') return normalized;
  return fallback;
};

const normalizeArtifactName = (value) => (
  typeof value === 'string'
    ? value
      .trim()
      .toLowerCase()
      .replace(/\\/g, '/')
      .replace(/\.json(?:l)?(?:\.(?:gz|zst))?$/i, '')
      .replace(/\.packed\.bin$/i, '')
      .replace(/\.bin$/i, '')
      .replace(/\.meta$/i, '')
      .replace(/(^|\/)pieces\//, '')
    : ''
);

const toArtifactNameSet = (values) => {
  const out = new Set();
  if (!Array.isArray(values)) return out;
  for (const value of values) {
    const normalized = normalizeArtifactName(value);
    if (normalized) out.add(normalized);
  }
  return out;
};

const DEFAULT_HOT_ARTIFACTS = Object.freeze([
  'chunk_meta',
  'chunk_meta.binary-columnar',
  'chunk_meta.binary-columnar_meta',
  'chunk_uid_map',
  'file_meta',
  'file_meta.binary-columnar',
  'file_meta.binary-columnar_meta',
  'token_postings',
  'token_postings.binary-columnar',
  'token_postings.binary-columnar_meta',
  'token_postings_packed',
  'token_postings_binary-columnar',
  'token_postings_binary-columnar_meta',
  'dense_vectors_uint8',
  'dense_vectors_doc_uint8',
  'dense_vectors_code_uint8',
  'dense_meta'
]);

const DEFAULT_COLD_ARTIFACTS = Object.freeze([
  'repo_map',
  'risk_summaries',
  'risk_flows',
  'call_sites',
  'graph_relations',
  'graph_relations_meta',
  'determinism_report',
  'extraction_report',
  'vocab_order'
]);

const resolveArtifactTierFromSets = ({
  artifactName,
  hotSet,
  coldSet,
  defaultTier
}) => {
  const normalizedName = normalizeArtifactName(artifactName);
  if (!normalizedName) return defaultTier;
  if (hotSet.has(normalizedName)) return 'hot';
  if (coldSet.has(normalizedName)) return 'cold';
  return defaultTier;
};

/**
 * Build a reusable compression-tier resolver with precomputed artifact sets.
 *
 * Use this when resolving tiers repeatedly (for example while constructing
 * compression overrides for many artifact surfaces) to avoid rebuilding hot/cold
 * lookup sets on each resolution call.
 *
 * @param {{
 *   hotArtifacts?: string[],
 *   coldArtifacts?: string[],
 *   defaultTier?: 'hot'|'warm'|'cold'
 * }} [options]
 * @returns {(artifactName:string)=>'hot'|'warm'|'cold'}
 */
export const createArtifactCompressionTierResolver = ({
  hotArtifacts = DEFAULT_HOT_ARTIFACTS,
  coldArtifacts = DEFAULT_COLD_ARTIFACTS,
  defaultTier = 'warm'
} = {}) => {
  const hotSet = toArtifactNameSet(hotArtifacts);
  const coldSet = toArtifactNameSet(coldArtifacts);
  const normalizedDefaultTier = normalizeTierName(defaultTier, 'warm');
  return (artifactName) => resolveArtifactTierFromSets({
    artifactName,
    hotSet,
    coldSet,
    defaultTier: normalizedDefaultTier
  });
};

/**
 * Resolve hot/warm/cold compression tier for an artifact surface.
 *
 * @param {string} artifactName
 * @param {{
 *   hotArtifacts?: string[],
 *   coldArtifacts?: string[],
 *   defaultTier?: 'hot'|'warm'|'cold'
 * }} [options]
 * @returns {'hot'|'warm'|'cold'}
 */
export const resolveArtifactCompressionTier = (
  artifactName,
  options = {}
) => createArtifactCompressionTierResolver(options)(artifactName);

export const detectCompression = (filePath) => {
  const target = stripBak(filePath);
  if (target.endsWith('.gz')) return 'gzip';
  if (target.endsWith('.zst')) return 'zstd';
  return null;
};

export const decompressBuffer = (buffer, compression, maxBytes, sourcePath) => {
  if (compression === 'gzip') {
    return gunzipWithLimit(buffer, maxBytes, sourcePath);
  }
  if (compression === 'zstd') {
    return zstdDecompressSync(buffer, maxBytes, sourcePath);
  }
  return buffer;
};

export const readBuffer = (targetPath, maxBytes) => {
  const stat = fs.statSync(targetPath);
  if (stat.size > maxBytes) {
    throw toJsonTooLargeError(targetPath, stat.size);
  }
  return fs.readFileSync(targetPath);
};

export const collectCompressedCandidates = (filePath) => {
  const candidates = [];
  const addCandidate = (targetPath, compression, cleanup) => {
    if (!fs.existsSync(targetPath)) return;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(targetPath).mtimeMs;
    } catch {}
    candidates.push({ path: targetPath, compression, cleanup, mtimeMs });
  };
  const zstPath = `${filePath}.zst`;
  const gzPath = `${filePath}.gz`;
  addCandidate(zstPath, 'zstd', true);
  addCandidate(getBakPath(zstPath), 'zstd', false);
  addCandidate(gzPath, 'gzip', true);
  addCandidate(getBakPath(gzPath), 'gzip', false);
  candidates.sort((a, b) => {
    if (a.cleanup !== b.cleanup) return a.cleanup ? -1 : 1;
    return b.mtimeMs - a.mtimeMs;
  });
  return candidates;
};

export const collectCompressedJsonlCandidates = (filePath) => {
  const candidates = [];
  const addCandidate = (targetPath, compression, cleanup) => {
    if (!fs.existsSync(targetPath)) return;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(targetPath).mtimeMs;
    } catch {}
    candidates.push({ path: targetPath, compression, cleanup, mtimeMs });
  };
  const zstPath = `${filePath}.zst`;
  const gzPath = `${filePath}.gz`;
  addCandidate(zstPath, 'zstd', true);
  addCandidate(getBakPath(zstPath), 'zstd', false);
  addCandidate(gzPath, 'gzip', true);
  addCandidate(getBakPath(gzPath), 'gzip', false);
  candidates.sort((a, b) => {
    if (a.cleanup !== b.cleanup) return a.cleanup ? -1 : 1;
    return b.mtimeMs - a.mtimeMs;
  });
  return candidates;
};
