import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildIndexSignature } from '../retrieval/index-cache.js';
import { sha1 } from '../shared/hash.js';
import { stableStringify } from '../shared/stable-json.js';
import { atomicWriteText } from '../shared/io/atomic-write.js';
import { readJsonResourceText } from '../shared/file-read-resource.js';
import {
  buildGenerationKey,
  resolveCacheScopedBuildIdRoot,
  resolveCacheScopedBuildPointerRoot,
  resolveCurrentBuildRoots
} from '../shared/indexing/build-pointer.js';
import { validateWorkspaceManifest } from '../contracts/validators/workspace.js';
import { resolveRepoCacheRootPath } from '../shared/repo-paths.js';
import { retainRepoCacheAccess } from '../shared/cache/repo-access.js';
import { assertCurrentIndexFormat } from '../contracts/index-format.js';
import { describeStorageFailure, observeStorageResource } from '../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../shared/storage/operation-error.js';
import {
  getCacheRoot,
  loadUserConfig,
  resolveSqlitePaths
} from '../shared/dict-utils.js';
import { loadWorkspaceConfig, snapshotWorkspaceMember, assertWorkspaceMemberCurrent } from './config.js';
import { toRealPathSync } from './identity.js';

export const WORKSPACE_MANIFEST_SCHEMA_VERSION = 1;
export const WORKSPACE_INDEX_MODES = ['code', 'prose', 'extracted-prose', 'records'];
const WORKSPACE_JSON_MAX_BYTES = 8 * 1024 * 1024;

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

const fileExists = (value, signal = null) => {
  signal?.throwIfAborted();
  try {
    fs.statSync(value);
    signal?.throwIfAborted();
    return true;
  } catch (error) {
    const failure = describeStorageFailure(error, { phase: 'workspace-artifact-stat' });
    signal?.throwIfAborted();
    if (['ENOENT', 'ENOTDIR'].includes(failure.code)) return false;
    throw error;
  }
};

const statIfExists = async (value, signal = null) => {
  signal?.throwIfAborted();
  try {
    const stat = await fsPromises.stat(value);
    signal?.throwIfAborted();
    return stat;
  } catch (error) {
    const failure = describeStorageFailure(error, { phase: 'workspace-path-stat' });
    signal?.throwIfAborted();
    if (!['ENOENT', 'ENOTDIR'].includes(failure.code)) throw error;
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


const signatureFromStat = (stat) => (
  stat ? `${stat.size}:${stat.mtimeMs}` : null
);

const hasAnyArtifact = (indexDir, markers, signal) => markers.some((marker) => (
  fileExists(path.join(indexDir, marker), signal)
));

const hasRequiredArtifacts = (indexDir, signal) => (
  hasAnyArtifact(indexDir, CHUNK_META_MARKERS, signal) && hasAnyArtifact(indexDir, TOKEN_POSTINGS_MARKERS, signal)
);

const readJsonFile = async (filePath, signal = null) => {
  signal?.throwIfAborted();
  try {
    const text = await readJsonResourceText(filePath, stat => {
      signal?.throwIfAborted();
      if (stat.size > WORKSPACE_JSON_MAX_BYTES) throw Object.assign(new Error('Workspace JSON exceeds its bounded read allowance.'),
        { code: 'ERR_JSON_FILE_TOO_LARGE' });
    });
    signal?.throwIfAborted();
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    observeStorageResource(error, { phase: 'workspace-json-read' }).requireSettled();
    signal?.throwIfAborted();
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
  activeRoot: null,
  buildRoots: {},
  modeRoots: {},
  hasExplicitModeRoots: false,
  invalidModeRoots: {},
  modes: []
});

/**
 * Load and normalize build pointer metadata for one repo's current build.
 *
 * Precedence:
 * 1) validate `builds/current.json` pointer bounds (reject out-of-cache roots),
 * 2) use the canonical root resolver on the same admitted pointer snapshot,
 * 3) keep explicit per-mode authority even when its selected artifacts are absent.
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
const readBuildPointerState = async ({ repoId, repoRootCanonical, repoCacheRoot, diagnostics, signal }) => {
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const currentJsonPath = path.join(buildsRoot, 'current.json');
  const currentStat = await statIfExists(currentJsonPath, signal);
  if (!currentStat) {
    return buildEmptyPointerState(currentJsonPath);
  }
  retainRepoCacheAccess(repoCacheRoot);
  const pointer = buildEmptyPointerState(currentJsonPath);
  pointer.currentJsonExists = true;
  pointer.currentJsonMtimeMs = currentStat.mtimeMs;
  const parsed = await readJsonFile(currentJsonPath, signal);
  if (!parsed.ok) {
    const failure = describeStorageFailure(parsed.error, { phase: 'workspace-pointer-diagnostic' });
    pointer.invalidPointer = true;
    diagnostics.warnings.push({
      code: 'WARN_WORKSPACE_INVALID_BUILD_POINTER',
      repoId,
      mode: null,
      message: `Invalid build pointer at ${currentJsonPath}: ${failure.message}`
    });
    return pointer;
  }
  pointer.parseOk = true;
  const data = ensureObject(parsed.value);
  const parsedModes = Array.isArray(data.modes)
    ? data.modes.filter((mode) => typeof mode === 'string' && mode.trim())
    : [];
  pointer.modes = Array.from(new Set(parsedModes.map((mode) => mode.trim())));
  pointer.buildId = normalizeString(data.buildId);
  const buildRootRaw = normalizeString(data.buildRoot);
  const invalidatePointer = (message) => {
    pointer.invalidPointer = true;
    pointer.buildId = null;
    pointer.buildRoot = null;
    pointer.activeRoot = null;
    pointer.buildRoots = {};
    pointer.modes = [];
    diagnostics.warnings.push({
      code: 'WARN_WORKSPACE_INVALID_BUILD_POINTER',
      repoId,
      mode: null,
      message
    });
    return pointer;
  };
  try {
    assertCurrentIndexFormat({ operation: 'workspace-manifest', component: 'build pointer',
      foundVersion: data.artifactSurfaceVersion, repoRoot: repoRootCanonical, indexPath: currentJsonPath });
  } catch (error) {
    if (error.code !== 'ERR_INDEX_FORMAT_UNSUPPORTED') throw error;
    return invalidatePointer(error.message);
  }
  if (data.buildRoot != null && typeof data.buildRoot !== 'string'
    || ['buildRootsByMode', 'buildRoots'].some(key => data[key] != null && data[key]?.constructor !== Object)) {
    return invalidatePointer(`Invalid build pointer shape at ${currentJsonPath}; build roots must use the canonical string/object representation.`);
  }

  // Reject malformed/escaped buildRoot pointers before resolver fallback can
  // substitute a local build directory for the same buildId.
  if (buildRootRaw) {
    const resolvedBuildRoot = resolveCacheScopedBuildPointerRoot(buildRootRaw, repoCacheRoot, buildsRoot);
    if (!resolvedBuildRoot) {
      return invalidatePointer(
        `Invalid build pointer at ${currentJsonPath}: buildRoot points outside repo cache (${buildRootRaw}).`
      );
    }
    pointer.buildRoot = toRealPathSync(resolvedBuildRoot);
  }
  if (!buildRootRaw && pointer.buildId) {
    const resolvedBuildIdRoot = resolveCacheScopedBuildIdRoot(pointer.buildId, repoCacheRoot, buildsRoot);
    if (!resolvedBuildIdRoot) {
      return invalidatePointer(
        `Invalid build pointer at ${currentJsonPath}: buildId points outside repo cache (${pointer.buildId}).`
      );
    }
  }

  const explicitRoots = data.buildRootsByMode?.constructor === Object ? data.buildRootsByMode
    : data.buildRoots?.constructor === Object ? data.buildRoots : null;
  pointer.hasExplicitModeRoots = explicitRoots !== null;
  const resolved = resolveCurrentBuildRoots(data, { repoCacheRoot, buildsRoot });
  pointer.buildId = resolved.buildId;
  pointer.buildRoot = resolved.buildRoot;
  pointer.activeRoot = resolved.activeRoot;
  pointer.buildRoots = resolved.buildRoots;
  for (const mode of WORKSPACE_INDEX_MODES) {
    const selected = resolveCurrentBuildRoots(data, { repoCacheRoot, buildsRoot, preferredMode: mode });
    const primaryDiagnosticRoot = !pointer.hasExplicitModeRoots && (!pointer.modes.length || pointer.modes.includes(mode))
      ? pointer.buildRoot : null;
    pointer.modeRoots[mode] = selected.activeRoot || pointer.buildRoots[mode] || primaryDiagnosticRoot;
  }
  for (const [mode, value] of Object.entries(explicitRoots || {})) {
    if (!WORKSPACE_INDEX_MODES.includes(mode)) continue;
    if (typeof value === 'string' && normalizeString(value)
      && resolveCacheScopedBuildPointerRoot(value, repoCacheRoot, buildsRoot)) continue;
    pointer.invalidModeRoots[mode] = true;
    diagnostics.warnings.push({ code: 'WARN_WORKSPACE_INVALID_BUILD_POINTER', repoId, mode,
      message: `Invalid ${mode} build root in ${currentJsonPath}; no primary-root fallback was selected.` });
  }
  return pointer;
};

const readIndexState = async (indexDir, diagnostics, repoId, mode, repoRootCanonical, signal) => {
  const statePath = path.join(indexDir, 'index_state.json');
  if (!fileExists(statePath, signal)) return { cohortKey: null, compatibilityKey: null };
  const parsed = await readJsonFile(statePath, signal);
  if (!parsed.ok) {
    const failure = describeStorageFailure(parsed.error, { phase: 'workspace-index-state-diagnostic' });
    diagnostics.warnings.push({
      code: 'WARN_WORKSPACE_INDEX_STATE_PARSE_FAILED',
      repoId,
      mode,
      message: `Failed to parse ${statePath}: ${failure.message}`
    });
    return { cohortKey: null, compatibilityKey: null };
  }
  const state = ensureObject(parsed.value);
  try {
    assertCurrentIndexFormat({ operation: 'workspace-manifest', component: 'index state',
      foundVersion: state.artifactSurfaceVersion, repoRoot: repoRootCanonical, indexPath: statePath });
  } catch (error) {
    if (error.code !== 'ERR_INDEX_FORMAT_UNSUPPORTED') throw error;
    diagnostics.warnings.push({ code: 'WARN_WORKSPACE_INDEX_FORMAT_UNSUPPORTED', repoId, mode, message: error.message });
    return { cohortKey: null, compatibilityKey: null, incompatibleFormat: true };
  }
  return {
    cohortKey: normalizeString(state.cohortKey),
    compatibilityKey: normalizeString(state.compatibilityKey)
  };
};

const buildModeEntry = async ({
  mode,
  pointer,
  diagnostics,
  repoId,
  repoRootCanonical,
  signal
}) => {
  signal?.throwIfAborted();
  const indexRoot = pointer.modeRoots[mode] || null;
  const indexDir = indexRoot ? path.join(indexRoot, `index-${mode}`) : null;
  const indexStat = indexDir ? await statIfExists(indexDir, signal) : null;
  const hasIndexDir = Boolean(indexStat?.isDirectory?.());
  let indexSignatureHash = null;
  let requiredArtifacts = false;
  let cohortKey = null;
  let compatibilityKey = null;
  let incompatibleFormat = false;
  if (hasIndexDir) {
    const signature = await buildIndexSignature(indexDir);
    signal?.throwIfAborted();
    indexSignatureHash = signature ? `is1-${sha1(signature)}` : null;
    requiredArtifacts = hasRequiredArtifacts(indexDir, signal);
    const stateKeys = await readIndexState(indexDir, diagnostics, repoId, mode, repoRootCanonical, signal);
    cohortKey = stateKeys.cohortKey;
    compatibilityKey = stateKeys.compatibilityKey;
    incompatibleFormat = stateKeys.incompatibleFormat === true;
  }

  let availabilityReason = 'present';
  if (pointer.invalidPointer || pointer.invalidModeRoots[mode]) {
    availabilityReason = 'invalid-pointer';
  } else if (!hasIndexDir) {
    availabilityReason = 'missing-index-dir';
  } else if (!requiredArtifacts) {
    availabilityReason = 'missing-required-artifacts';
  } else if (incompatibleFormat) {
    availabilityReason = 'incompatible-format';
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

const resolveSqliteEntry = async (dbPath, signal) => {
  signal?.throwIfAborted();
  if (!dbPath) return { path: null, present: false, fileSignature: null };
  const canonicalPath = toRealPathSync(dbPath);
  const stat = await statIfExists(canonicalPath, signal);
  return {
    path: canonicalPath,
    present: Boolean(stat?.isFile?.()),
    fileSignature: signatureFromStat(stat)
  };
};

const buildRepoManifestEntry = async (repoEntry, diagnostics, signal) => {
  signal?.throwIfAborted();
  assertWorkspaceMemberCurrent(repoEntry);
  const repoRootCanonical = repoEntry.repoRootCanonical;
  const userConfig = loadUserConfig(repoRootCanonical);
  const repoCacheRoot = toRealPathSync(resolveRepoCacheRootPath(repoRootCanonical, userConfig));
  // Missing cache roots have no resource to borrow. Existing data still
  // retains the same cleanup exclusion before pointer/artifact inspection.
  if (fs.existsSync(repoCacheRoot)) retainRepoCacheAccess(repoCacheRoot);
  const pointer = await readBuildPointerState({
    repoId: repoEntry.repoId,
    repoRootCanonical,
    repoCacheRoot,
    userConfig,
    diagnostics,
    signal
  });

  const indexes = {};
  for (const mode of WORKSPACE_INDEX_MODES) {
    signal?.throwIfAborted();
    indexes[mode] = await buildModeEntry({
      mode,
      pointer,
      diagnostics,
      repoId: repoEntry.repoId,
      repoRootCanonical,
      signal
    });
  }

  signal?.throwIfAborted();
  const sqlitePaths = resolveSqlitePaths(repoRootCanonical, userConfig);
  const sqlite = {
    dir: toRealPathSync(sqlitePaths.dbDir),
    dbs: {
      code: await resolveSqliteEntry(sqlitePaths.codePath, signal),
      prose: await resolveSqliteEntry(sqlitePaths.prosePath, signal),
      'extracted-prose': await resolveSqliteEntry(sqlitePaths.extractedProsePath, signal),
      records: await resolveSqliteEntry(sqlitePaths.recordsPath, signal)
    }
  };

  const entry = {
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
      activeRoot: pointer.activeRoot,
      generationKey: buildGenerationKey({
        buildId: pointer.buildId,
        buildRoot: pointer.buildRoot,
        activeRoot: pointer.activeRoot,
        buildRoots: pointer.buildRoots
      }),
      buildRoots: pointer.buildRoots,
      modes: pointer.modes
    },
    indexes,
    sqlite
  };
  assertWorkspaceMemberCurrent(repoEntry);
  signal?.throwIfAborted();
  return entry;
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
        activeRoot: repo?.build?.activeRoot || null,
        generationKey: repo?.build?.generationKey || null,
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

export const readWorkspaceManifest = async (manifestPath, { signal = null } = {}) => {
  const parsed = await readJsonFile(manifestPath, signal);
  if (!parsed.ok) {
    const failure = describeStorageFailure(parsed.error, { phase: 'workspace-manifest-diagnostic' });
    throw addStorageFailureContext(parsed.error, { workspaceManifestPath: manifestPath,
      workspaceManifestDiagnostic: `Failed to read workspace manifest ${manifestPath}: ${failure.message}` });
  }
  return parsed.value;
};

export const generateWorkspaceManifest = async (workspaceConfigOrPath, {
  write = true,
  allowPartial = false,
  generatedAt = null,
  manifestPath = null,
  platform = process.platform,
  signal = null
} = {}) => {
  signal?.throwIfAborted();
  const workspaceConfig = typeof workspaceConfigOrPath === 'string'
    ? loadWorkspaceConfig(workspaceConfigOrPath, { platform })
    : workspaceConfigOrPath;
  const diagnostics = { warnings: [], errors: [] };
  const members = workspaceConfig.repos.map(snapshotWorkspaceMember);

  const repos = [];
  for (const repoEntry of members) {
    signal?.throwIfAborted();
    try { repos.push(await buildRepoManifestEntry(repoEntry, diagnostics, signal)); }
    catch (error) {
      observeStorageResource(error, { phase: 'workspace-member-cancellation' }).requireSettled();
      signal?.throwIfAborted();
      if (write || !allowPartial) throw error;
      const failure = describeStorageFailure(error, { phase: 'workspace-member-inspection',
        defaultCode: 'ERR_WORKSPACE_MEMBER_INSPECTION' });
      diagnostics.errors.push({ repoId: repoEntry.repoId, repoRootCanonical: repoEntry.repoRootCanonical,
        code: failure.code, message: failure.message });
    }
  }
  repos.sort((a, b) => a.repoId.localeCompare(b.repoId));
  signal?.throwIfAborted();

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
  const validation = validateWorkspaceManifest(manifest);
  if (!validation.ok) {
    throw new Error(`Workspace manifest schema validation failed: ${validation.errors.join('; ')}`);
  }
  const outputPath = manifestPath || getWorkspaceManifestPath(workspaceConfig);
  if (write) {
    signal?.throwIfAborted();
    await atomicWriteText(outputPath, stableStringify(manifest), { newline: true, signal,
      beforeCommit: () => { signal?.throwIfAborted(); for (const member of members) assertWorkspaceMemberCurrent(member); } });
  }
  return {
    manifest,
    manifestPath: outputPath
  };
};
