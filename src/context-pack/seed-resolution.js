import { normalizePathForRepo } from '../shared/path-normalize.js';
import { loadJsonArrayArtifactRows } from '../shared/artifact-io.js';

export const resolveSeedRef = (seed) => {
  if (!seed || typeof seed !== 'object') return null;
  if (seed.type && typeof seed.type === 'string') return seed;
  if ('status' in seed) return seed;
  return null;
};

export const resolveSeedCandidates = (seed) => {
  if (!seed || typeof seed !== 'object' || !('status' in seed)) return [];
  const candidates = Array.isArray(seed.candidates) ? seed.candidates : [];
  const resolved = seed.resolved && typeof seed.resolved === 'object' ? seed.resolved : null;
  const out = [];
  const seen = new Set();
  const pushUnique = (candidate) => {
    if (!candidate || typeof candidate !== 'object') return;
    const key = candidate.chunkUid
      ? `chunk:${candidate.chunkUid}`
      : candidate.symbolId
        ? `symbol:${candidate.symbolId}`
        : candidate.path
          ? `file:${candidate.path}`
          : null;
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };
  if (resolved) pushUnique(resolved);
  for (const candidate of candidates) pushUnique(candidate);
  return out;
};

export const buildChunkIndex = (chunkMeta, { repoRoot = null } = {}) => {
  if (!Array.isArray(chunkMeta)) return null;
  const byChunkUid = new Map();
  const byFile = new Map();
  const bySymbol = new Map();
  for (const chunk of chunkMeta) {
    if (!chunk) continue;
    const entry = { ...chunk };
    const chunkUid = entry.chunkUid || entry.metaV2?.chunkUid || null;
    if (chunkUid && !byChunkUid.has(chunkUid)) byChunkUid.set(chunkUid, entry);
    const normalizedFile = normalizePathForRepo(entry.file, repoRoot);
    if (normalizedFile) {
      const list = byFile.get(normalizedFile) || [];
      list.push(entry);
      byFile.set(normalizedFile, list);
    }
    const symbolId = entry.metaV2?.symbol?.symbolId || null;
    if (symbolId && !bySymbol.has(symbolId)) bySymbol.set(symbolId, entry);
  }
  return {
    byChunkUid,
    byFile,
    bySymbol,
    normalizePath: (value) => normalizePathForRepo(value, repoRoot)
  };
};

export const resolveChunkCandidatesBySeed = (seedRef, chunkIndex) => {
  if (!seedRef || !chunkIndex) return [];
  const { byChunkUid, byFile, bySymbol, normalizePath } = chunkIndex;
  const resolved = [];
  const seen = new Set();
  const resolveFromNode = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'chunk') return node.chunkUid ? [byChunkUid.get(node.chunkUid) || null] : [];
    if (node.type === 'file') {
      const normalizedPath = normalizePath ? normalizePath(node.path) : node.path;
      const list = (normalizedPath && byFile.get(normalizedPath)) || byFile.get(node.path) || [];
      return Array.isArray(list) ? list : [];
    }
    if (node.type === 'symbol') return node.symbolId ? [bySymbol.get(node.symbolId) || null] : [];
    return [];
  };
  const pushResolved = (ref, chunk, candidateIndex = null) => {
    if (!ref?.type || !chunk) return;
    const chunkUid = chunk.chunkUid || chunk.metaV2?.chunkUid || null;
    if (!chunkUid || seen.has(chunkUid)) return;
    seen.add(chunkUid);
    resolved.push({ ref, chunk, chunkUid, candidateIndex });
  };
  if (seedRef?.type) {
    for (const chunk of resolveFromNode(seedRef)) {
      pushResolved(seedRef, chunk, 0);
    }
    return resolved;
  }
  if (!('status' in seedRef)) return resolved;
  const candidates = resolveSeedCandidates(seedRef);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const ref = candidate?.chunkUid
      ? { type: 'chunk', chunkUid: candidate.chunkUid }
      : candidate?.path
        ? { type: 'file', path: candidate.path }
        : candidate?.symbolId
          ? { type: 'symbol', symbolId: candidate.symbolId }
          : null;
    if (!ref) continue;
    for (const chunk of resolveFromNode(ref)) {
      pushResolved(ref, chunk, index);
    }
  }
  return resolved;
};

export const resolveChunkBySeed = (seedRef, chunkIndex, warnings) => {
  if (!chunkIndex) return null;
  const candidates = resolveChunkCandidatesBySeed(seedRef, chunkIndex);

  if (seedRef?.type) {
    const chunk = candidates[0]?.chunk || null;
    if (!chunk) {
      warnings.push({
        code: 'SEED_NOT_FOUND',
        message: `Seed ${seedRef.type} could not be resolved to chunk metadata.`
      });
    }
    return chunk;
  }

  if (seedRef && 'status' in seedRef) {
    if (candidates[0]?.chunk) return candidates[0].chunk;
    warnings.push({
      code: 'SEED_UNRESOLVED',
      message: 'Seed reference envelope could not be resolved to a chunk.'
    });
  }
  return null;
};

export const resolvePrimaryRef = (seedRef, chunk) => {
  if (seedRef?.type) return seedRef;
  if (chunk?.chunkUid || chunk?.metaV2?.chunkUid) {
    return { type: 'chunk', chunkUid: chunk.chunkUid || chunk.metaV2.chunkUid };
  }
  if (chunk?.file) return { type: 'file', path: chunk.file };
  return seedRef || null;
};

export const resolveChunkUidMapSeedRefs = (seedRef) => {
  if (!seedRef || typeof seedRef !== 'object') return [];
  if (seedRef.type && typeof seedRef.type === 'string') return [seedRef];
  if (!('status' in seedRef)) return [];
  const candidates = resolveSeedCandidates(seedRef);
  const refs = [];
  const seen = new Set();
  const pushUnique = (ref) => {
    if (!ref?.type) return;
    const key = ref.type === 'chunk'
      ? `chunk:${ref.chunkUid || ''}`
      : ref.type === 'file'
        ? `file:${ref.path || ''}`
        : ref.type === 'symbol'
          ? `symbol:${ref.symbolId || ''}`
          : null;
    if (!key || seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };
  for (const candidate of candidates) {
    if (candidate?.chunkUid) {
      pushUnique({ type: 'chunk', chunkUid: candidate.chunkUid });
    } else if (candidate?.path) {
      pushUnique({ type: 'file', path: candidate.path });
    } else if (candidate?.symbolId) {
      pushUnique({ type: 'symbol', symbolId: candidate.symbolId });
    }
  }
  return refs;
};

export const normalizeChunkUidMapRowAsChunk = (row) => {
  if (!row || typeof row !== 'object') return null;
  if (!Number.isFinite(row.docId) || !row.chunkUid || !row.file) return null;
  return {
    id: row.docId,
    chunkUid: row.chunkUid,
    chunkId: row.chunkId || null,
    file: row.file,
    start: Number.isFinite(row.start) ? row.start : null,
    end: Number.isFinite(row.end) ? row.end : null,
    startLine: null,
    endLine: null
  };
};

export const buildChunkUidMapSeedIndex = async ({
  indexDir,
  manifest,
  strict,
  repoRoot
} = {}) => {
  if (!indexDir) return null;
  const byChunkUid = new Map();
  const byFile = new Map();
  let rowsIndexed = 0;
  try {
    for await (const row of loadJsonArrayArtifactRows(indexDir, 'chunk_uid_map', {
      manifest,
      strict
    })) {
      const chunk = normalizeChunkUidMapRowAsChunk(row);
      if (!chunk) continue;
      rowsIndexed += 1;
      if (chunk.chunkUid && !byChunkUid.has(chunk.chunkUid)) {
        byChunkUid.set(chunk.chunkUid, chunk);
      }
      const normalizedFile = normalizePathForRepo(chunk.file, repoRoot);
      if (normalizedFile) {
        const list = byFile.get(normalizedFile) || [];
        list.push(chunk);
        byFile.set(normalizedFile, list);
      }
    }
  } catch {
    return null;
  }
  return {
    byChunkUid,
    byFile,
    rowsIndexed
  };
};

export const resolveChunkUidMapSeedCandidatesFromIndex = ({
  seedIndex,
  seedRef,
  repoRoot
} = {}) => {
  if (!seedIndex || !seedRef) return [];
  if (seedRef.type === 'chunk') {
    const chunk = seedRef.chunkUid ? (seedIndex.byChunkUid.get(seedRef.chunkUid) || null) : null;
    return chunk ? [chunk] : [];
  }
  if (seedRef.type === 'file') {
    const normalizedSeedFile = normalizePathForRepo(seedRef.path, repoRoot);
    return normalizedSeedFile ? (seedIndex.byFile.get(normalizedSeedFile) || []) : [];
  }
  return [];
};
