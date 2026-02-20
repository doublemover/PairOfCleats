import fsSync from 'node:fs';
import path from 'node:path';
import {
  readJson,
  loadOptionalFileMetaRows,
  loadSqliteIndexOptionalArtifacts
} from '../../utils.js';
import {
  MAX_JSON_BYTES,
  loadTokenPostings,
  readJsonLinesEach,
  resolveArtifactPresence,
  resolveJsonlRequiredKeys
} from '../../../../shared/artifact-io.js';

const listShardFiles = (dir, prefix, extensions) => {
  if (!dir || typeof dir !== 'string' || !fsSync.existsSync(dir)) return [];
  const allowed = Array.isArray(extensions) && extensions.length
    ? extensions
    : ['.json', '.jsonl'];
  return fsSync
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && allowed.some((ext) => name.endsWith(ext)))
    .sort()
    .map((name) => path.join(dir, name));
};

const resolveFirstExistingPath = (basePath) => {
  const candidates = [basePath, `${basePath}.gz`, `${basePath}.zst`];
  return candidates.find((candidate) => fsSync.existsSync(candidate)) || null;
};

const normalizeMetaParts = (parts) => (
  Array.isArray(parts)
    ? parts
      .map((part) => {
        if (typeof part === 'string') return part;
        return typeof part?.path === 'string' ? part.path : null;
      })
      .filter(Boolean)
    : []
);

export const inflateColumnarRows = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const arrays = payload.arrays && typeof payload.arrays === 'object' ? payload.arrays : null;
  if (!arrays) return null;
  const columns = Array.isArray(payload.columns) ? payload.columns : Object.keys(arrays);
  if (!columns.length) return [];
  const tables = payload.tables && typeof payload.tables === 'object' ? payload.tables : null;
  const length = Number.isFinite(payload.length)
    ? payload.length
    : (Array.isArray(arrays[columns[0]]) ? arrays[columns[0]].length : 0);
  const rows = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const row = {};
    for (const column of columns) {
      const values = arrays[column];
      const value = Array.isArray(values) ? (values[i] ?? null) : null;
      const table = tables && Array.isArray(tables[column]) ? tables[column] : null;
      row[column] = table && Number.isInteger(value) ? (table[value] ?? null) : value;
    }
    rows[i] = row;
  }
  return rows;
};

export const resolveChunkMetaSources = (dir) => {
  if (!dir || typeof dir !== 'string') {
    dir = typeof dir?.dir === 'string' ? dir.dir : null;
  }
  if (!dir) return null;
  const presence = resolveArtifactPresence(dir, 'chunk_meta', {
    maxBytes: MAX_JSON_BYTES,
    strict: false
  });
  if (presence?.missingMeta && presence?.metaPath) {
    throw new Error(`[sqlite] chunk_meta meta missing: ${presence.metaPath}`);
  }
  if (Array.isArray(presence?.missingPaths) && presence.missingPaths.length) {
    throw new Error(`[sqlite] chunk_meta parts missing: ${presence.missingPaths.join(', ')}`);
  }
  if (Array.isArray(presence?.paths) && presence.paths.length) {
    return {
      format: presence.format === 'json' || presence.format === 'columnar' ? presence.format : 'jsonl',
      paths: presence.paths
    };
  }
  const metaPath = path.join(dir, 'chunk_meta.meta.json');
  const partsDir = path.join(dir, 'chunk_meta.parts');
  if (fsSync.existsSync(metaPath) || fsSync.existsSync(partsDir)) {
    let parts = [];
    if (fsSync.existsSync(metaPath)) {
      const metaRaw = readJson(metaPath);
      const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
      const entries = normalizeMetaParts(meta?.parts);
      if (entries.length) {
        const missing = [];
        parts = entries.map((name) => {
          const candidate = path.join(dir, name);
          if (!fsSync.existsSync(candidate)) missing.push(name);
          return candidate;
        });
        if (missing.length) {
          throw new Error(`[sqlite] chunk_meta parts missing: ${missing.join(', ')}`);
        }
      }
    }
    if (!parts.length) {
      parts = listShardFiles(partsDir, 'chunk_meta.part-', ['.jsonl', '.jsonl.gz', '.jsonl.zst']);
    }
    if (parts.length) {
      return { format: 'jsonl', paths: parts };
    }
  }

  const jsonlResolved = resolveFirstExistingPath(path.join(dir, 'chunk_meta.jsonl'));
  if (jsonlResolved) {
    return { format: 'jsonl', paths: [jsonlResolved] };
  }
  const jsonResolved = resolveFirstExistingPath(path.join(dir, 'chunk_meta.json'));
  if (jsonResolved) {
    return { format: 'json', paths: [jsonResolved] };
  }
  return null;
};

export const resolveTokenPostingsSources = (dir) => {
  if (!dir || typeof dir !== 'string') {
    dir = typeof dir?.dir === 'string' ? dir.dir : null;
  }
  if (!dir) return null;
  const metaPath = path.join(dir, 'token_postings.meta.json');
  const shardsDir = path.join(dir, 'token_postings.shards');
  if (!fsSync.existsSync(metaPath) && !fsSync.existsSync(shardsDir)) return null;
  let parts = [];
  if (fsSync.existsSync(metaPath)) {
    try {
      const metaRaw = readJson(metaPath);
      const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
      const entries = normalizeMetaParts(meta?.parts);
      if (entries.length) {
        parts = entries.map((name) => path.join(dir, name));
      }
    } catch {}
  }
  if (!parts.length) {
    parts = listShardFiles(shardsDir, 'token_postings.part-', ['.json', '.json.gz', '.json.zst']);
  }
  return parts.length ? { metaPath, parts } : null;
};

export const normalizeTfPostingRows = (posting) => {
  if (!Array.isArray(posting) || posting.length <= 1) return Array.isArray(posting) ? posting : [];
  let previousDocId = -1;
  let alreadySortedUnique = true;
  for (const entry of posting) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const docIdRaw = Number(entry[0]);
    if (!Number.isFinite(docIdRaw)) continue;
    const docId = Math.max(0, Math.floor(docIdRaw));
    if (docId <= previousDocId) {
      alreadySortedUnique = false;
      break;
    }
    previousDocId = docId;
  }
  if (alreadySortedUnique) return posting;
  const merged = new Map();
  for (const entry of posting) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const docIdRaw = Number(entry[0]);
    const tfRaw = Number(entry[1]);
    if (!Number.isFinite(docIdRaw) || !Number.isFinite(tfRaw)) continue;
    const docId = Math.max(0, Math.floor(docIdRaw));
    const tf = Math.max(0, Math.floor(tfRaw));
    if (!tf) continue;
    merged.set(docId, (merged.get(docId) || 0) + tf);
  }
  if (!merged.size) return [];
  return Array.from(merged.entries()).sort((a, b) => a[0] - b[0]);
};

export const CHUNK_META_REQUIRED_KEYS = resolveJsonlRequiredKeys('chunk_meta');

export const readJsonLinesFile = async (
  filePath,
  onEntry,
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null } = {}
) => readJsonLinesEach(filePath, onEntry, { maxBytes, requiredKeys });

/**
 * Load artifact pieces required for sqlite builds.
 * @param {string|{indexDir?:string,modes?:string[],modelId?:string}} dirOrOptions
 * @param {string} [modelId]
 * @returns {object|null}
 */
export const loadIndexPieces = async (dirOrOptions, modelId) => {
  if (dirOrOptions && typeof dirOrOptions === 'object' && !Array.isArray(dirOrOptions)) {
    const { indexDir, modes, modelId: modelIdOverride } = dirOrOptions;
    const baseDir = typeof indexDir === 'string' ? indexDir : null;
    const modeList = Array.isArray(modes) ? modes.filter((mode) => typeof mode === 'string') : [];
    const resolvedModelId = modelIdOverride ?? modelId;
    if (baseDir && modeList.length) {
      const piecesByMode = {};
      for (const mode of modeList) {
        const suffix = `${path.sep}index-${mode}`;
        const modeDir = baseDir.endsWith(suffix) ? baseDir : path.join(baseDir, `index-${mode}`);
        const pieces = await loadIndexPieces(modeDir, resolvedModelId);
        if (pieces) piecesByMode[mode] = pieces;
      }
      return piecesByMode;
    }
    dirOrOptions = baseDir;
    modelId = resolvedModelId;
  }
  const dir = dirOrOptions;
  if (!dir || typeof dir !== 'string') return null;
  const sources = resolveChunkMetaSources(dir);
  if (!sources) return null;
  const optional = loadSqliteIndexOptionalArtifacts(dir, { modelId });
  return {
    chunkMeta: null,
    dir,
    fileMeta: optional.fileMeta,
    denseVec: optional.denseVec,
    phraseNgrams: optional.phraseNgrams,
    chargrams: optional.chargrams,
    minhash: optional.minhash,
    tokenPostings: null,
    chunkMetaSources: sources,
    tokenPostingsSources: resolveTokenPostingsSources(dir)
  };
};

export { loadOptionalFileMetaRows, loadTokenPostings, readJson, MAX_JSON_BYTES };
