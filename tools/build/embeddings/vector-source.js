import fsSync from 'node:fs';
import path from 'node:path';
import { readJsonFile } from '../../../src/shared/artifact-io/json.js';
import {
  loadPiecesManifest,
  normalizeMetaParts
} from '../../../src/shared/artifact-io/manifest.js';
import {
  loadJsonArrayArtifactRows
} from '../../../src/shared/artifact-io/loaders.js';

export const toCanonicalArtifactBase = (base) => {
  if (!base || typeof base !== 'string') return '';
  if (base.endsWith('_uint8')) return base.slice(0, -('_uint8'.length));
  if (base.endsWith('_f32')) return base.slice(0, -('_f32'.length));
  if (base.endsWith('_float32')) return base.slice(0, -('_float32'.length));
  if (base.endsWith('_fp32')) return base.slice(0, -('_fp32'.length));
  return base;
};

export const resolveArtifactBaseCandidates = (base, { includeCanonical = false } = {}) => {
  const candidates = [];
  const add = (value) => {
    if (!value || candidates.includes(value)) return;
    candidates.push(value);
  };
  add(base);
  if (includeCanonical) add(toCanonicalArtifactBase(base));
  return candidates;
};

export const resolveManifestAliasNames = (artifactBase) => {
  const aliases = [];
  const add = (value) => {
    if (!value || aliases.includes(value)) return;
    aliases.push(value);
  };
  const canonical = toCanonicalArtifactBase(artifactBase);
  add(artifactBase);
  add(canonical);
  add(`${canonical}_binary`);
  add(`${canonical}_binary_meta`);
  return aliases;
};

export const buildShardOnlyManifest = (artifactBase, meta) => {
  const parts = normalizeMetaParts(meta?.parts)
    .map((entry) => (typeof entry === 'string' ? entry.replace(/\\/g, '/') : ''))
    .filter(Boolean);
  if (!parts.length) return null;
  return {
    pieces: parts.map((partPath) => ({
      name: artifactBase,
      path: partPath,
      format: 'jsonl'
    }))
  };
};

export const resolveShardCount = (meta) => {
  const totalRecords = Number(meta?.totalRecords);
  if (Number.isFinite(totalRecords) && totalRecords >= 0) {
    return Math.max(0, Math.floor(totalRecords));
  }
  const count = Number(meta?.count);
  if (Number.isFinite(count) && count >= 0) {
    return Math.max(0, Math.floor(count));
  }
  return 0;
};

const readVectorsPayload = (filePath) => {
  const data = readJsonFile(filePath, { maxBytes: Number.POSITIVE_INFINITY });
  return Array.isArray(data?.arrays?.vectors)
    ? data.arrays.vectors
    : (Array.isArray(data?.vectors) ? data.vectors : null);
};

const loadOptionalPiecesManifest = (dir) => {
  try {
    return loadPiecesManifest(dir, {
      maxBytes: Number.POSITIVE_INFINITY,
      strict: false
    });
  } catch {
    return null;
  }
};

const collectManifestNames = (manifest) => new Set(
  Array.isArray(manifest?.pieces)
    ? manifest.pieces
      .map((piece) => (piece && typeof piece.name === 'string' ? piece.name : null))
      .filter(Boolean)
    : []
);

export const resolveVectorsSource = (vectorsPath, {
  includeCanonicalBase = false,
  requireManifestDeclaration = false,
  tryCandidateJson = false,
  stopOnShardMetaWithoutManifest = false
} = {}) => {
  if (!vectorsPath) return null;
  const dir = path.dirname(vectorsPath);
  const base = path.basename(vectorsPath, path.extname(vectorsPath));
  const ext = path.extname(vectorsPath) || '.json';
  const baseCandidates = resolveArtifactBaseCandidates(base, { includeCanonical: includeCanonicalBase });
  const manifestNames = requireManifestDeclaration
    ? collectManifestNames(loadOptionalPiecesManifest(dir))
    : new Set();

  for (const artifactBase of baseCandidates) {
    if (manifestNames.size) {
      const aliases = resolveManifestAliasNames(artifactBase);
      const declared = aliases.some((name) => manifestNames.has(name));
      if (!declared) continue;
    }
    const metaPath = path.join(dir, `${artifactBase}.meta.json`);
    const hasShardedMeta = fsSync.existsSync(metaPath) || fsSync.existsSync(`${metaPath}.bak`);
    if (!hasShardedMeta) continue;
    try {
      const meta = readJsonFile(metaPath, { maxBytes: Number.POSITIVE_INFINITY });
      const count = resolveShardCount(meta);
      const shardManifest = buildShardOnlyManifest(artifactBase, meta);
      if (!shardManifest) {
        if (stopOnShardMetaWithoutManifest) return null;
        continue;
      }
      return {
        count,
        vectors: null,
        rows: loadJsonArrayArtifactRows(dir, artifactBase, {
          maxBytes: Number.POSITIVE_INFINITY,
          manifest: shardManifest,
          strict: false,
          materialize: true
        })
      };
    } catch {}
  }

  if (tryCandidateJson) {
    for (const artifactBase of baseCandidates) {
      const candidatePath = path.join(dir, `${artifactBase}${ext}`);
      try {
        const vectors = readVectorsPayload(candidatePath);
        if (!Array.isArray(vectors) || !vectors.length) continue;
        return { count: vectors.length, vectors, rows: null };
      } catch {}
    }
  }

  try {
    const vectors = readVectorsPayload(vectorsPath);
    if (!Array.isArray(vectors) || !vectors.length) return null;
    return { count: vectors.length, vectors, rows: null };
  } catch {}
  return null;
};
