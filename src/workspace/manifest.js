import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildIndexSignature } from '../retrieval/index-cache.js';
import { sha1 } from '../shared/hash.js';
import { stableStringify } from '../shared/stable-json.js';
import { atomicWriteText } from '../shared/io/atomic-write.js';
import { isAbsolutePathNative } from '../shared/files.js';
import {
  getCacheRoot,
  getCurrentBuildInfo,
  getRepoCacheRoot,
  loadUserConfig,
  resolveSqlitePaths
} from '../../tools/shared/dict-utils.js';
import { loadWorkspaceConfig } from './config.js';
import { toRealPathSync } from './identity.js';

export const WORKSPACE_MANIFEST_SCHEMA_VERSION = 1;
export const WORKSPACE_INDEX_MODES = ['code', 'prose', 'extracted-prose', 'records'];

const CHUNK_META_MARKERS = [
  'chunk_meta.json',
  'chunk_meta.json.gz',
  'chunk_meta.json.zst',
  'chunk_meta.jsonl',
  'chunk_meta.jsonl.gz',
  'chunk_meta.jsonl.zst',
  'chunk_meta.meta.json',
  'chunk_meta.parts',
  path.join('chunk_meta.parts', 'chunk_meta.part-00001.jsonl'),
  path.join('chunk_meta.parts', 'chunk_meta.part-00001.jsonl.gz')
];

const TOKEN_POSTINGS_MARKERS = [
  'token_postings.json',
  'token_postings.json.gz',
  'token_postings.json.zst',
  'token_postings.meta.json',
  'token_postings.shards',
  path.join('token_postings.shards', 'token_postings.part-00001.jsonl'),
  path.join('token_postings.shards', 'token_postings.part-00001.jsonl.gz'),
  'token_postings.packed.bin',
  'token_postings.packed.meta.json'
];

const fileExists = (value) => {
  try {
    return fs.existsSync(value);
  } catch {
    return false;
  }
};

const statIfExists = async (value) => {
  try {
    return await fsPromises.stat(value);
  } catch {
    return null;
  }
};

const ensureObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

const normalizeString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const sortDiagnostics = (entries) => (
  (Array.isArray(entries) ? entries : [])
    .slice()
    .sort((a, b) => (
      String(a?.repoId || '').localeCompare(String(b?.repoId || ''))
      || String(a?.mode || '').localeCompare(String(b?.mode || ''))
      || String(a?.code || '').localeCompare(String(b?.code || ''))
      || String(a?.message || '').localeCompare(String(b?.message || ''))
    ))
);

const modePath = (entry, mode) => (
  entry?.indexes && entry.indexes[mode] ? entry.indexes[mode] : null
);

/**
 * Resolve a build pointer root only if it remains within the repo cache root.
 *
 * Supports both absolute pointers and relative pointers (resolved against
 * repo cache root and builds root). Returns null when the pointer escapes the
 * allowed repo cache boundary.
 *
 * @param {string} value
 * @param {string} repoCacheRoot
 * @param {string} buildsRoot
 * @returns {string|null}
 */
const resolvePointerRoot = (value, repoCacheRoot, buildsRoot) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const repoCacheResolved = path.resolve(repoCacheRoot);
  const candidates = isAbsolutePathNative(trimmed)
    ? [trimmed]
    : [
      path.join(repoCacheRoot, trimmed),
      path.join(buildsRoot, trimmed)
    ];
  for (const candidate of candidates) {
    const normalized = path.resolve(candidate);
    if (normalized === repoCacheResolved || normalized.startsWith(repoCacheResolved + path.sep)) {
      return normalized;
    }
  }
  return null;
};

const signatureFromStat = (stat) => (
  stat ? `${stat.size}:${stat.mtimeMs}` : null
);

const hasAnyArtifact = (indexDir, markers) => markers.some((marker) => (
  fileExists(path.join(indexDir, marker))
));

const hasRequiredArtifacts = (indexDir) => (
  hasAnyArtifact(indexDir, CHUNK_META_MARKERS) && hasAnyArtifact(indexDir, TOKEN_POSTINGS_MARKERS)
);

const readJsonFile = async (filePath) => {
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error };
  }
};

const buildEmptyPointerState = (currentJsonPath) => ({
  currentJsonPath,
  currentJsonExists: false,
  currentJsonMtimeMs: null,
  parseOk: false,
  invalidPointer: false,
  buildId: null,
  buildRoot: null,
  buildRoots: {},
  modes: []
});

/**
 * Load and normalize build pointer metadata for one repo's current build.
 *
 * Precedence:
 * 1) use `getCurrentBuildInfo()` when available (authoritative resolver),
 * 2) otherwise parse `builds/current.json` with strict in-repo-cache pointer
 *    validation.
 *
 * Any parse failure or out-of-bound buildRoot marks the pointer invalid and
 * returns an empty/cleared pointer state, so manifest generation remains
 * deterministic and does not consume external build directories.
 *
 * @param {{
 *   repoId:string,
 *   repoRootCanonical:string,
 *   repoCacheRoot:string,
 *   userConfig:any,
 *   diagnostics:{warnings:any[],errors:any[]}
 * }} input
 * @returns {Promise<{
 *   currentJsonPath:string,
 *   currentJsonExists:boolean,
 *   currentJsonMtimeMs:number|null,
 *   parseOk:boolean,
 *   invalidPointer:boolean,
 *   buildId:string|null,
 *   buildRoot:string|null,
 *   buildRoots:Record<string,string>,
 *   modes:string[]
 * }>}
 */
const readBuildPointerState = async ({ repoId, repoRootCanonical, repoCacheRoot, userConfig, diagnostics }) => {
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const currentJsonPath = path.join(buildsRoot, 'current.json');
  const currentStat = await statIfExists(currentJsonPath);
  if (!currentStat) {
    return buildEmptyPointerState(currentJsonPath);
  }
  const pointer = buildEmptyPointerState(currentJsonPath);
  pointer.currentJsonExists = true;
  pointer.currentJsonMtimeMs = currentStat.mtimeMs;
  const parsed = await readJsonFile(currentJsonPath);
  if (!parsed.ok) {
    pointer.invalidPointer = true;
    diagnostics.warnings.push({
      code: 'WARN_WORKSPACE_INVALID_BUILD_POINTER',
      repoId,
      mode: null,
      message: `Invalid build pointer at ${currentJsonPath}: ${parsed.error?.message || parsed.error}`
    });
    return pointer;
  }
  pointer.parseOk = true;
  const data = ensureObject(parsed.value);
  const parsedModes = Array.isArray(data.modes)
    ? data.modes.filter((mode) => typeof mode === 'string' && mode.trim())
    : [];
  pointer.modes = Array.from(new Set(parsedModes.map((mode) => mode.trim())));

  const currentInfo = getCurrentBuildInfo(repoRootCanonical, userConfig) || null;
  if (currentInfo) {
    pointer.buildId = normalizeString(currentInfo.buildId);
    pointer.buildRoot = currentInfo.buildRoot ? toRealPathSync(currentInfo.buildRoot) : null;
    for (const [mode, rootValue] of Object.entries(ensureObject(currentInfo.buildRoots))) {
      const normalized = normalizeString(rootValue);
      if (!normalized) continue;
      pointer.buildRoots[mode] = toRealPathSync(normalized);
    }
    if (!pointer.modes.length) {
      pointer.modes = Object.keys(pointer.buildRoots).sort();
    }
    return pointer;
  }

  pointer.buildId = normalizeString(data.buildId);
  const buildRootRaw = normalizeString(data.buildRoot);
  if (buildRootRaw) {
    const resolvedBuildRoot = resolvePointerRoot(buildRootRaw, repoCacheRoot, buildsRoot);
    if (!resolvedBuildRoot) {
      pointer.invalidPointer = true;
      pointer.buildId = null;
      pointer.buildRoot = null;
      pointer.buildRoots = {};
      pointer.modes = [];
      diagnostics.warnings.push({
        code: 'WARN_WORKSPACE_INVALID_BUILD_POINTER',
        repoId,
        mode: null,
        message: `Invalid build pointer at ${currentJsonPath}: buildRoot points outside repo cache (${buildRootRaw}).`
      });
      return pointer;
    }
    pointer.buildRoot = toRealPathSync(resolvedBuildRoot);
  } else {
    pointer.buildRoot = pointer.buildId ? toRealPathSync(path.join(buildsRoot, pointer.buildId)) : null;
  }

  const buildRootsInput = ensureObject(data.buildRootsByMode?.constructor === Object ? data.buildRootsByMode : data.buildRoots);
  for (const [mode, value] of Object.entries(buildRootsInput)) {
    const resolved = resolvePointerRoot(value, repoCacheRoot, buildsRoot);
    if (!resolved) continue;
    pointer.buildRoots[mode] = toRealPathSync(resolved);
  }
  return pointer;
};

const readIndexState = async (indexDir, diagnostics, repoId, mode) => {
  const statePath = path.join(indexDir, 'index_state.json');
  if (!fileExists(statePath)) return { cohortKey: null, compatibilityKey: null };
  const parsed = await readJsonFile(statePath);
  if (!parsed.ok) {
    diagnostics.warnings.push({
      code: 'WARN_WORKSPACE_INDEX_STATE_PARSE_FAILED',
      repoId,
      mode,
      message: `Failed to parse ${statePath}: ${parsed.error?.message || parsed.error}`
    });
    return { cohortKey: null, compatibilityKey: null };
  }
  const state = ensureObject(parsed.value);
  return {
    cohortKey: normalizeString(state.cohortKey),
    compatibilityKey: normalizeString(state.compatibilityKey)
  };
};

const buildModeEntry = async ({
  mode,
  pointer,
  diagnostics,
  repoId
}) => {
  const modeFromBuildRoot = pointer.buildRoot && (
    !Array.isArray(pointer.modes)
    || pointer.modes.length === 0
    || pointer.modes.includes(mode)
  );
  const indexRoot = pointer.buildRoots[mode] || (modeFromBuildRoot ? pointer.buildRoot : null);
  const indexDir = indexRoot ? path.join(indexRoot, `index-${mode}`) : null;
  const indexStat = indexDir ? await statIfExists(indexDir) : null;
  const hasIndexDir = Boolean(indexStat?.isDirectory?.());
  let indexSignatureHash = null;
  let requiredArtifacts = false;
  let cohortKey = null;
  let compatibilityKey = null;
  if (hasIndexDir) {
    const signature = await buildIndexSignature(indexDir);
    indexSignatureHash = signature ? `is1-${sha1(signature)}` : null;
    requiredArtifacts = hasRequiredArtifacts(indexDir);
    const stateKeys = await readIndexState(indexDir, diagnostics, repoId, mode);
    cohortKey = stateKeys.cohortKey;
    compatibilityKey = stateKeys.compatibilityKey;
  }

  let availabilityReason = 'present';
  if (pointer.invalidPointer) {
    availabilityReason = 'invalid-pointer';
  } else if (!hasIndexDir) {
    availabilityReason = 'missing-index-dir';
  } else if (!requiredArtifacts) {
    availabilityReason = 'missing-required-artifacts';
  } else if (!cohortKey && !compatibilityKey) {
    availabilityReason = 'compat-key-missing';
    diagnostics.warnings.push({
      code: 'WARN_WORKSPACE_COMPAT_KEY_MISSING',
      repoId,
      mode,
      message: `Both cohortKey and compatibilityKey are missing for ${mode}.`
    });
  }

  return {
    mode,
    indexRoot,
    indexDir: hasIndexDir ? toRealPathSync(indexDir) : (indexDir ? toRealPathSync(indexDir) : null),
    present: hasIndexDir,
    indexSignatureHash,
    cohortKey,
    compatibilityKey,
    availabilityReason,
    details: {
      requiredArtifactsPresent: requiredArtifacts
    }
  };
};

const resolveSqliteEntry = async (dbPath) => {
  if (!dbPath) return { path: null, present: false, fileSignature: null };
  const canonicalPath = toRealPathSync(dbPath);
  const stat = await statIfExists(canonicalPath);
  return {
    path: canonicalPath,
    present: Boolean(stat?.isFile?.()),
    fileSignature: signatureFromStat(stat)
  };
};

const buildRepoManifestEntry = async (repoEntry, diagnostics) => {
  const repoRootCanonical = repoEntry.repoRootCanonical;
  const userConfig = loadUserConfig(repoRootCanonical);
  const repoCacheRoot = toRealPathSync(getRepoCacheRoot(repoRootCanonical, userConfig));
  const pointer = await readBuildPointerState({
    repoId: repoEntry.repoId,
    repoRootCanonical,
    repoCacheRoot,
    userConfig,
    diagnostics
  });

  const indexes = {};
  for (const mode of WORKSPACE_INDEX_MODES) {
    indexes[mode] = await buildModeEntry({
      mode,
      pointer,
      diagnostics,
      repoId: repoEntry.repoId
    });
  }

  const sqlitePaths = resolveSqlitePaths(repoRootCanonical, userConfig);
  const sqlite = {
    dir: toRealPathSync(sqlitePaths.dbDir),
    dbs: {
      code: await resolveSqliteEntry(sqlitePaths.codePath),
      prose: await resolveSqliteEntry(sqlitePaths.prosePath),
      'extracted-prose': await resolveSqliteEntry(sqlitePaths.extractedProsePath),
      records: await resolveSqliteEntry(sqlitePaths.recordsPath)
    }
  };

  return {
    repoId: repoEntry.repoId,
    repoRootCanonical,
    repoCacheRoot,
    alias: repoEntry.alias,
    tags: Array.isArray(repoEntry.tags) ? [...repoEntry.tags] : [],
    enabled: Boolean(repoEntry.enabled),
    priority: Number.isInteger(repoEntry.priority) ? repoEntry.priority : 0,
    build: {
      currentJsonPath: pointer.currentJsonPath,
      currentJsonExists: pointer.currentJsonExists,
      currentJsonMtimeMs: pointer.currentJsonMtimeMs,
      parseOk: pointer.parseOk,
      buildId: pointer.buildId,
      buildRoot: pointer.buildRoot,
      buildRoots: pointer.buildRoots,
      modes: pointer.modes
    },
    indexes,
    sqlite
  };
};

export const resolveFederationCacheRoot = (workspaceConfig) => {
  const configured = normalizeString(workspaceConfig?.cacheRoot);
  const root = configured ? path.resolve(configured) : path.resolve(getCacheRoot());
  return toRealPathSync(root);
};

export const getWorkspaceManifestPath = (workspaceConfig) => (
  path.join(
    resolveFederationCacheRoot(workspaceConfig),
    'federation',
    workspaceConfig.repoSetId,
    'workspace_manifest.json'
  )
);

export const computeManifestHash = (manifestLike) => {
  const repos = (Array.isArray(manifestLike?.repos) ? manifestLike.repos : [])
    .slice()
    .sort((a, b) => String(a?.repoId || '').localeCompare(String(b?.repoId || '')))
    .map((repo) => ({
      repoId: repo.repoId,
      repoRootCanonical: repo.repoRootCanonical,
      repoCacheRoot: repo.repoCacheRoot,
      build: {
        buildId: repo?.build?.buildId || null,
        currentJsonMtimeMs: Number.isFinite(Number(repo?.build?.currentJsonMtimeMs))
          ? Number(repo.build.currentJsonMtimeMs)
          : null,
        buildRoots: ensureObject(repo?.build?.buildRoots)
      },
      indexes: WORKSPACE_INDEX_MODES.reduce((acc, mode) => {
        const entry = modePath(repo, mode) || {};
        acc[mode] = {
          present: Boolean(entry.present),
          indexSignatureHash: entry.indexSignatureHash || null,
          cohortKey: entry.cohortKey || null,
          compatibilityKey: entry.compatibilityKey || null,
          availabilityReason: entry.availabilityReason || 'missing-index-dir'
        };
        return acc;
      }, {}),
      sqlite: WORKSPACE_INDEX_MODES.reduce((acc, mode) => {
        const db = repo?.sqlite?.dbs && repo.sqlite.dbs[mode] ? repo.sqlite.dbs[mode] : {};
        acc[mode] = {
          present: Boolean(db.present),
          fileSignature: db.fileSignature || null
        };
        return acc;
      }, {})
    }));

  const core = {
    v: 1,
    schemaVersion: WORKSPACE_MANIFEST_SCHEMA_VERSION,
    repoSetId: manifestLike?.repoSetId || null,
    repos
  };
  return `wm1-${sha1(stableStringify(core))}`;
};

export const readWorkspaceManifest = async (manifestPath) => {
  const parsed = await readJsonFile(manifestPath);
  if (!parsed.ok) {
    throw new Error(`Failed to read workspace manifest ${manifestPath}: ${parsed.error?.message || parsed.error}`);
  }
  return parsed.value;
};

export const generateWorkspaceManifest = async (workspaceConfigOrPath, {
  write = true,
  generatedAt = null,
  manifestPath = null,
  platform = process.platform
} = {}) => {
  const workspaceConfig = typeof workspaceConfigOrPath === 'string'
    ? loadWorkspaceConfig(workspaceConfigOrPath, { platform })
    : workspaceConfigOrPath;
  const diagnostics = { warnings: [], errors: [] };

  const repos = [];
  for (const repoEntry of workspaceConfig.repos) {
    const repoManifest = await buildRepoManifestEntry(repoEntry, diagnostics);
    repos.push(repoManifest);
  }
  repos.sort((a, b) => a.repoId.localeCompare(b.repoId));

  const manifest = {
    schemaVersion: WORKSPACE_MANIFEST_SCHEMA_VERSION,
    generatedAt: generatedAt || new Date().toISOString(),
    repoSetId: workspaceConfig.repoSetId,
    manifestHash: null,
    federationCacheRoot: resolveFederationCacheRoot(workspaceConfig),
    workspace: {
      workspacePath: workspaceConfig.workspacePath,
      name: workspaceConfig.name || '',
      workspaceConfigHash: workspaceConfig.workspaceConfigHash || null
    },
    repos,
    diagnostics: {
      warnings: sortDiagnostics(diagnostics.warnings),
      errors: sortDiagnostics(diagnostics.errors)
    }
  };

  manifest.manifestHash = computeManifestHash(manifest);
  const outputPath = manifestPath || getWorkspaceManifestPath(workspaceConfig);
  if (write) {
    await atomicWriteText(outputPath, stableStringify(manifest), { newline: true });
  }
  return {
    manifest,
    manifestPath: outputPath
  };
};
