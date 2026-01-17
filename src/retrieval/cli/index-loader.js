import fs from 'node:fs';
import path from 'node:path';
import { loadIndexWithCache } from '../index-cache.js';
import { MAX_JSON_BYTES, readJsonFile } from '../../shared/artifact-io.js';
import { resolveIndexDir } from '../cli-index.js';

export function hasLmdbStore(storePath) {
  if (!storePath || !fs.existsSync(storePath)) return false;
  return fs.existsSync(path.join(storePath, 'data.mdb'));
}

export async function loadIndexCached({
  indexCache,
  dir,
  modelIdDefault,
  fileChargramN,
  includeHnsw = true,
  hnswConfig,
  loadIndex
}) {
  return loadIndexWithCache(
    indexCache,
    dir,
    {
      modelIdDefault,
      fileChargramN,
      includeHnsw,
      hnswConfig
    },
    loadIndex
  );
}

export function hasIndexMeta(dir) {
  if (!dir) return false;
  const metaPath = path.join(dir, 'chunk_meta.json');
  const metaJsonlPath = path.join(dir, 'chunk_meta.jsonl');
  const metaPartsPath = path.join(dir, 'chunk_meta.meta.json');
  const metaPartsDir = path.join(dir, 'chunk_meta.parts');
  return fs.existsSync(metaPath)
    || fs.existsSync(metaJsonlPath)
    || fs.existsSync(metaPartsPath)
    || fs.existsSync(metaPartsDir);
}

export function warnPendingState(idx, label, { emitOutput, useSqlite, annActive }) {
  if (!emitOutput) return;
  const state = idx?.state;
  if (!state || useSqlite) return;
  if (state.enrichment?.pending) {
    console.warn(`[search] ${label} index enrichment pending (stage1).`);
  }
  if (annActive && state.embeddings?.enabled && state.embeddings.ready === false) {
    console.warn(`[search] ${label} embeddings pending; ANN may be limited.`);
  }
}

export function resolveDenseVector(idx, mode, denseVectorMode) {
  if (!idx) return null;
  if (denseVectorMode === 'code') return idx.denseVecCode || idx.denseVec || null;
  if (denseVectorMode === 'doc') return idx.denseVecDoc || idx.denseVec || null;
  if (denseVectorMode === 'auto') {
    if (mode === 'code') return idx.denseVecCode || idx.denseVec || null;
    if (mode === 'prose' || mode === 'extracted-prose') {
      return idx.denseVecDoc || idx.denseVec || null;
    }
  }
  return idx.denseVec || null;
}

export function loadFileRelations(rootDir, userConfig, mode) {
  try {
    const dir = resolveIndexDir(rootDir, mode, userConfig);
    const relPath = path.join(dir, 'file_relations.json');
    if (!fs.existsSync(relPath)) return null;
    const raw = readJsonFile(relPath, { maxBytes: MAX_JSON_BYTES });
    if (!Array.isArray(raw)) return null;
    const map = new Map();
    for (const entry of raw) {
      if (!entry?.file) continue;
      map.set(entry.file, entry.relations || null);
    }
    return map;
  } catch {
    return null;
  }
}

export function loadRepoMap(rootDir, userConfig, mode) {
  try {
    const dir = resolveIndexDir(rootDir, mode, userConfig);
    const mapPath = path.join(dir, 'repo_map.json');
    if (!fs.existsSync(mapPath)) return null;
    const raw = readJsonFile(mapPath, { maxBytes: MAX_JSON_BYTES });
    return Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}
