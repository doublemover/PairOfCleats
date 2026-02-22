import fs from 'node:fs';
import path from 'node:path';
import { getIndexDir } from './dict-utils.js';

const DEFAULT_PARITY_MODES = Object.freeze(['code', 'prose']);
export const DEFAULT_PARITY_CHUNK_META_CANDIDATES = Object.freeze([
  'chunk_meta.json',
  'chunk_meta.jsonl',
  'chunk_meta.meta.json'
]);

const normalizeList = (values, fallback) => {
  if (!Array.isArray(values) || values.length === 0) return [...fallback];
  const normalized = values
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return normalized.length ? normalized : [...fallback];
};

const hasChunkMetaArtifact = (dir, chunkMetaCandidates) => {
  if (!dir) return false;
  for (const candidateName of chunkMetaCandidates) {
    if (fs.existsSync(path.join(dir, candidateName))) return true;
  }
  return false;
};

/**
 * Resolve index dir for parity checks (cache-first, local fallback).
 * @param {string} root
 * @param {'code'|'prose'} mode
 * @param {object} userConfig
 * @param {{chunkMetaCandidates?:string[]}} [options]
 * @returns {string}
 */
export function resolveParityIndexDir(root, mode, userConfig, options = {}) {
  const chunkMetaCandidates = normalizeList(
    options.chunkMetaCandidates,
    DEFAULT_PARITY_CHUNK_META_CANDIDATES
  );
  const cached = getIndexDir(root, mode, userConfig);
  if (hasChunkMetaArtifact(cached, chunkMetaCandidates)) return cached;
  const local = path.join(root, `index-${mode}`);
  if (hasChunkMetaArtifact(local, chunkMetaCandidates)) return local;
  return cached;
}

/**
 * Resolve the best existing chunk-meta path in an index directory.
 * @param {string} indexDir
 * @param {{chunkMetaCandidates?:string[]}} [options]
 * @returns {string}
 */
export function resolveParityChunkMetaPath(indexDir, options = {}) {
  const chunkMetaCandidates = normalizeList(
    options.chunkMetaCandidates,
    DEFAULT_PARITY_CHUNK_META_CANDIDATES
  );
  for (const candidateName of chunkMetaCandidates) {
    const candidatePath = path.join(indexDir, candidateName);
    if (fs.existsSync(candidatePath)) return candidatePath;
  }
  return path.join(indexDir, chunkMetaCandidates[0] || 'chunk_meta.json');
}

/**
 * Snapshot parity index/sqlite artifact presence.
 * @param {{
 *   root:string,
 *   userConfig:object,
 *   modes?:Array<'code'|'prose'>,
 *   chunkMetaCandidates?:string[],
 *   resolveSqlitePathsForRoot?:()=>{codePath?:string,prosePath?:string}
 * }} options
 * @returns {{
 *   indexByMode:Record<string,{mode:string,dir:string,metaPath:string,exists:boolean}>,
 *   missingIndex:Array<{mode:string,dir:string,metaPath:string,exists:boolean}>,
 *   sqlitePaths:{codePath?:string,prosePath?:string}|null,
 *   missingSqliteEntries:Array<{mode:'code'|'prose',path:string|null}>,
 *   missingSqlite:boolean
 * }}
 */
export function readParityArtifactState(options) {
  const {
    root,
    userConfig,
    modes,
    chunkMetaCandidates,
    resolveSqlitePathsForRoot
  } = options;
  const resolvedModes = normalizeList(modes, DEFAULT_PARITY_MODES);
  const resolvedChunkMetaCandidates = normalizeList(
    chunkMetaCandidates,
    DEFAULT_PARITY_CHUNK_META_CANDIDATES
  );

  const indexByMode = {};
  const missingIndex = [];
  for (const mode of resolvedModes) {
    const dir = resolveParityIndexDir(root, mode, userConfig, {
      chunkMetaCandidates: resolvedChunkMetaCandidates
    });
    const metaPath = resolveParityChunkMetaPath(dir, {
      chunkMetaCandidates: resolvedChunkMetaCandidates
    });
    const exists = fs.existsSync(metaPath);
    const state = { mode, dir, metaPath, exists };
    indexByMode[mode] = state;
    if (!exists) missingIndex.push(state);
  }

  const sqlitePaths = typeof resolveSqlitePathsForRoot === 'function'
    ? (resolveSqlitePathsForRoot() || null)
    : null;

  const sqliteEntries = sqlitePaths
    ? [
      { mode: 'code', path: sqlitePaths.codePath ? String(sqlitePaths.codePath) : null },
      { mode: 'prose', path: sqlitePaths.prosePath ? String(sqlitePaths.prosePath) : null }
    ]
    : [];

  const missingSqliteEntries = sqliteEntries.filter((entry) => !entry.path || !fs.existsSync(entry.path));

  return {
    indexByMode,
    missingIndex,
    sqlitePaths,
    missingSqliteEntries,
    missingSqlite: missingSqliteEntries.length > 0
  };
}

/**
 * Ensure parity index/sqlite artifacts with caller-provided build hooks.
 * @param {{
 *   root:string,
 *   userConfig:object,
 *   modes?:Array<'code'|'prose'>,
 *   chunkMetaCandidates?:string[],
 *   resolveSqlitePathsForRoot?:()=>{codePath?:string,prosePath?:string},
 *   canBuild?:boolean,
 *   buildIndex?:(state:ReturnType<typeof readParityArtifactState>)=>void|Promise<void>,
 *   buildSqlite?:(state:ReturnType<typeof readParityArtifactState>)=>void|Promise<void>,
 *   buildIndexOnSqliteMissing?:boolean,
 *   buildSqliteAfterIndexBuild?:boolean
 * }} options
 * @returns {Promise<ReturnType<typeof readParityArtifactState>>}
 */
export async function ensureParityArtifacts(options) {
  const {
    root,
    userConfig,
    modes,
    chunkMetaCandidates,
    resolveSqlitePathsForRoot,
    canBuild = false,
    buildIndex = null,
    buildSqlite = null,
    buildIndexOnSqliteMissing = false,
    buildSqliteAfterIndexBuild = false
  } = options;

  const readState = () => readParityArtifactState({
    root,
    userConfig,
    modes,
    chunkMetaCandidates,
    resolveSqlitePathsForRoot
  });

  let state = readState();
  if (!state.missingIndex.length && !state.missingSqlite) return state;
  if (!canBuild) return state;

  const shouldBuildIndex = state.missingIndex.length > 0
    || (buildIndexOnSqliteMissing && state.missingSqlite);
  let didBuildIndex = false;
  if (shouldBuildIndex && typeof buildIndex === 'function') {
    await buildIndex(state);
    didBuildIndex = true;
    state = readState();
  }

  const shouldBuildSqlite = state.missingSqlite || (didBuildIndex && buildSqliteAfterIndexBuild);
  if (shouldBuildSqlite && typeof buildSqlite === 'function') {
    await buildSqlite(state);
  }

  return readState();
}
