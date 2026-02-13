import fs from 'node:fs';
import path from 'node:path';
import { getRepoCacheRoot } from '../shared/dict-utils.js';
import { createError, ERROR_CODES } from '../shared/error-codes.js';
import { isAbsolutePathAny } from '../shared/files.js';
import { sha1 } from '../shared/hash.js';
import { stableStringify } from '../shared/stable-json.js';

const VALID_MODES = Object.freeze(['code', 'prose', 'extracted-prose', 'records']);
const BUILD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const SNAPSHOT_ID_RE = /^snap-[A-Za-z0-9._-]+$/;
const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

const invalidRequest = (message, details = null) => createError(ERROR_CODES.INVALID_REQUEST, message, details);
const notFound = (message, details = null) => createError(ERROR_CODES.NOT_FOUND, message, details);

const withinRoot = (rootPath, targetPath) => {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  if (process.platform === 'win32') {
    const rootLower = root.toLowerCase();
    const targetLower = target.toLowerCase();
    return targetLower === rootLower || targetLower.startsWith(`${rootLower}${path.sep}`);
  }
  return target === root || target.startsWith(`${root}${path.sep}`);
};

const readJsonFile = (filePath, label, { required = false } = {}) => {
  if (!fs.existsSync(filePath)) {
    if (!required) return null;
    throw notFound(`${label} not found: ${filePath}`);
  }
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return payload;
  } catch (err) {
    throw invalidRequest(`Invalid ${label}: ${err?.message || err}`, { cause: err });
  }
};

const normalizeRequestedModes = (requestedModes) => {
  if (!Array.isArray(requestedModes) || requestedModes.length === 0) {
    return [...VALID_MODES];
  }
  const resolved = [];
  for (const modeRaw of requestedModes) {
    const mode = String(modeRaw || '').trim().toLowerCase();
    if (!mode) continue;
    if (!VALID_MODES.includes(mode)) {
      throw invalidRequest(`Invalid mode "${mode}". Use ${VALID_MODES.join('|')}.`);
    }
    if (!resolved.includes(mode)) resolved.push(mode);
  }
  if (resolved.length === 0) {
    return [...VALID_MODES];
  }
  return resolved;
};

/**
 * Resolve a build root candidate under the repo cache boundary.
 *
 * For relative values, resolution prefers `<repoCacheRoot>/builds/<id>` when
 * the token looks like a build id, and only accepts candidates that both stay
 * within the repo cache scope and currently exist.
 *
 * @param {string} repoCacheRoot
 * @param {string} buildsRoot
 * @param {string} value
 * @param {string} label
 * @returns {string|null}
 */
const resolveCacheScopedPath = (repoCacheRoot, buildsRoot, value, label) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  const candidates = (() => {
    if (isAbsolutePathAny(trimmed)) return [trimmed];
    // build-id-style pointers should prefer <repoCacheRoot>/builds/<buildId>.
    if (BUILD_ID_RE.test(trimmed)) {
      return [
        path.join(buildsRoot, trimmed),
        path.join(repoCacheRoot, trimmed)
      ];
    }
    return [
      path.join(repoCacheRoot, trimmed),
      path.join(buildsRoot, trimmed)
    ];
  })();
  let sawScopedCandidate = false;
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (withinRoot(repoCacheRoot, resolved)) {
      sawScopedCandidate = true;
      if (fs.existsSync(resolved)) return resolved;
    }
  }
  if (sawScopedCandidate) return null;
  throw invalidRequest(`${label} escapes repo cache root: ${trimmed}`);
};

const collectBuildStateByMode = ({
  indexBaseRootByMode,
  modes,
  allowMissingModes,
  warnings
}) => {
  const cache = new Map();
  const buildIdByMode = {};
  const configHashByMode = {};
  const toolVersionByMode = {};

  const loadState = (rootPath, mode) => {
    if (cache.has(rootPath)) return cache.get(rootPath);
    const statePath = path.join(rootPath, 'build_state.json');
    if (!fs.existsSync(statePath)) {
      if (!allowMissingModes) {
        throw notFound(`Missing build_state.json for ${mode}.`);
      }
      warnings.push(`Missing build_state.json for ${mode}`);
      cache.set(rootPath, null);
      return null;
    }
    const state = readJsonFile(statePath, `build_state.json (${mode})`, { required: true });
    cache.set(rootPath, state);
    return state;
  };

  for (const mode of modes) {
    const rootPath = indexBaseRootByMode[mode];
    if (!rootPath) continue;
    const state = loadState(rootPath, mode);
    if (!state) continue;
    if (typeof state.buildId === 'string' && state.buildId) {
      buildIdByMode[mode] = state.buildId;
    }
    if (Object.prototype.hasOwnProperty.call(state, 'configHash')) {
      configHashByMode[mode] = state.configHash == null ? null : String(state.configHash);
    }
    if (state.tool && typeof state.tool === 'object' && Object.prototype.hasOwnProperty.call(state.tool, 'version')) {
      toolVersionByMode[mode] = state.tool.version == null ? null : String(state.tool.version);
    }
  }

  return { buildIdByMode, configHashByMode, toolVersionByMode };
};

const hasAbsolutePathValue = (value) => {
  if (typeof value === 'string') return isAbsolutePathAny(value);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => hasAbsolutePathValue(entry));
  return Object.values(value).some((entry) => hasAbsolutePathValue(entry));
};

const finalizeResolved = ({
  requested,
  parsed,
  indexBaseRootByMode,
  identity,
  snapshot,
  warnings
}) => {
  if (hasAbsolutePathValue(identity)) {
    throw createError(ERROR_CODES.INTERNAL, 'Resolved identity must not contain absolute paths.');
  }
  const identityHash = sha1(stableStringify(identity));
  const indexDirByMode = {};
  for (const [mode, rootPath] of Object.entries(indexBaseRootByMode)) {
    indexDirByMode[mode] = path.join(rootPath, `index-${mode}`);
  }
  return {
    requested,
    parsed,
    canonical: parsed.canonical,
    indexBaseRootByMode,
    indexDirByMode,
    identity,
    identityHash,
    snapshot: snapshot || null,
    warnings: Array.isArray(warnings) ? [...warnings] : []
  };
};

const resolveLatest = ({
  repoCacheRoot,
  buildsRoot,
  modes,
  allowMissingModes,
  warnings
}) => {
  const currentPath = path.join(buildsRoot, 'current.json');
  const current = readJsonFile(currentPath, 'builds/current.json', { required: true });
  const buildRoots = (current.buildRoots && typeof current.buildRoots === 'object' && !Array.isArray(current.buildRoots))
    ? current.buildRoots
    : ((current.buildRootsByMode && typeof current.buildRootsByMode === 'object' && !Array.isArray(current.buildRootsByMode))
      ? current.buildRootsByMode
      : {});
  const defaultRoot = typeof current.buildRoot === 'string' ? current.buildRoot : null;
  const currentBuildId = (typeof current.buildId === 'string' && BUILD_ID_RE.test(current.buildId.trim()))
    ? current.buildId.trim()
    : null;
  const indexBaseRootByMode = {};

  for (const mode of modes) {
    const modeRootRaw = buildRoots[mode] ?? defaultRoot ?? currentBuildId;
    if (!modeRootRaw) {
      if (allowMissingModes) {
        warnings.push(`Missing build root for ${mode}`);
        continue;
      }
      throw notFound(`Missing build root for ${mode} in builds/current.json.`);
    }
    const rootPath = resolveCacheScopedPath(repoCacheRoot, buildsRoot, modeRootRaw, `build root (${mode})`);
    if (!rootPath || !fs.existsSync(rootPath)) {
      if (allowMissingModes) {
        warnings.push(`Missing index base root for ${mode}`);
        continue;
      }
      throw notFound(`Missing index base root for ${mode}: ${modeRootRaw}`);
    }
    indexBaseRootByMode[mode] = rootPath;
  }

  const metadata = collectBuildStateByMode({ indexBaseRootByMode, modes, allowMissingModes, warnings });
  const identity = { type: 'latest' };
  if (Object.keys(metadata.buildIdByMode).length) identity.buildIdByMode = metadata.buildIdByMode;
  if (Object.keys(metadata.configHashByMode).length) identity.configHashByMode = metadata.configHashByMode;
  if (Object.keys(metadata.toolVersionByMode).length) identity.toolVersionByMode = metadata.toolVersionByMode;
  return { indexBaseRootByMode, identity, snapshot: null };
};

const resolveBuild = ({
  repoCacheRoot,
  buildsRoot,
  modes,
  buildId,
  allowMissingModes,
  warnings
}) => {
  const buildRoot = path.join(buildsRoot, buildId);
  const indexBaseRootByMode = {};
  for (const mode of modes) {
    if (fs.existsSync(buildRoot)) {
      indexBaseRootByMode[mode] = buildRoot;
      continue;
    }
    if (allowMissingModes) {
      warnings.push(`Missing build root for ${mode}: ${buildId}`);
      continue;
    }
    throw notFound(`Build root not found: ${path.relative(repoCacheRoot, buildRoot) || buildRoot}`);
  }

  const metadata = collectBuildStateByMode({
    indexBaseRootByMode,
    modes,
    allowMissingModes: true,
    warnings
  });
  const stateBuildId = Object.values(metadata.buildIdByMode)[0] || null;
  if (stateBuildId && stateBuildId !== buildId) {
    warnings.push(`build_state.json buildId mismatch: requested ${buildId}, found ${stateBuildId}`);
  }
  const buildIdByMode = {};
  for (const mode of modes) {
    if (!indexBaseRootByMode[mode]) continue;
    buildIdByMode[mode] = metadata.buildIdByMode[mode] || buildId;
  }
  const identity = {
    type: 'build',
    buildIdByMode
  };
  if (Object.keys(metadata.configHashByMode).length) identity.configHashByMode = metadata.configHashByMode;
  if (Object.keys(metadata.toolVersionByMode).length) identity.toolVersionByMode = metadata.toolVersionByMode;
  return { indexBaseRootByMode, identity, snapshot: null };
};

const loadSnapshotSources = (repoCacheRoot, snapshotId) => {
  const snapshotsRoot = path.join(repoCacheRoot, 'snapshots');
  const manifest = readJsonFile(path.join(snapshotsRoot, 'manifest.json'), 'snapshots/manifest.json', { required: true });
  const entry = manifest?.snapshots?.[snapshotId] || null;
  if (!entry) {
    throw notFound(`Snapshot not found: ${snapshotId}`);
  }
  const snapshotDir = path.join(snapshotsRoot, snapshotId);
  const snapshotJson = readJsonFile(path.join(snapshotDir, 'snapshot.json'), `snapshot ${snapshotId}`, { required: true });
  const frozenJson = readJsonFile(path.join(snapshotDir, 'frozen.json'), `frozen metadata for ${snapshotId}`);
  return { manifest, entry, snapshotDir, snapshotJson, frozenJson };
};

const resolveSnapshot = ({
  repoCacheRoot,
  buildsRoot,
  modes,
  snapshotId,
  preferFrozen,
  allowMissingModes,
  warnings,
  identityType = 'snapshot',
  tag = null
}) => {
  const { entry, snapshotDir, snapshotJson, frozenJson } = loadSnapshotSources(repoCacheRoot, snapshotId);
  const hasFrozen = Boolean(entry?.hasFrozen || frozenJson);
  const indexBaseRootByMode = {};
  const pointer = snapshotJson.pointer && typeof snapshotJson.pointer === 'object' ? snapshotJson.pointer : {};
  const pointerRootsByMode = (pointer.buildRootsByMode && typeof pointer.buildRootsByMode === 'object')
    ? pointer.buildRootsByMode
    : ((snapshotJson.buildRootsByMode && typeof snapshotJson.buildRootsByMode === 'object') ? snapshotJson.buildRootsByMode : {});
  const pointerBuildRoot = typeof pointer.buildRoot === 'string'
    ? pointer.buildRoot
    : (typeof snapshotJson.buildRoot === 'string' ? snapshotJson.buildRoot : null);
  const pointerBuildIdByMode = (pointer.buildIdByMode && typeof pointer.buildIdByMode === 'object')
    ? pointer.buildIdByMode
    : {};

  if (preferFrozen && hasFrozen) {
    const frozenRoot = path.join(snapshotDir, 'frozen');
    if (!fs.existsSync(frozenRoot)) {
      if (!allowMissingModes) {
        throw notFound(`Frozen root missing for snapshot ${snapshotId}.`);
      }
      warnings.push(`Frozen root missing for snapshot ${snapshotId}`);
    } else {
      for (const mode of modes) {
        indexBaseRootByMode[mode] = frozenRoot;
      }
    }
  } else {
    for (const mode of modes) {
      const rawRoot = pointerRootsByMode[mode] ?? pointerBuildRoot;
      if (!rawRoot) {
        if (allowMissingModes) {
          warnings.push(`Snapshot ${snapshotId} missing build root for ${mode}`);
          continue;
        }
        throw notFound(`Snapshot ${snapshotId} missing build root for ${mode}.`);
      }
      const resolvedRoot = resolveCacheScopedPath(repoCacheRoot, buildsRoot, rawRoot, `snapshot root (${mode})`);
      if (!resolvedRoot || !fs.existsSync(resolvedRoot)) {
        if (allowMissingModes) {
          warnings.push(`Snapshot ${snapshotId} references missing build root for ${mode}`);
          continue;
        }
        throw notFound(`Snapshot ${snapshotId} references missing build root ${rawRoot}.`);
      }
      indexBaseRootByMode[mode] = resolvedRoot;
    }
  }

  const metadata = collectBuildStateByMode({ indexBaseRootByMode, modes, allowMissingModes: true, warnings });
  const buildIdByMode = {};
  for (const mode of modes) {
    if (!indexBaseRootByMode[mode]) continue;
    const fromState = metadata.buildIdByMode[mode];
    const fromPointer = typeof pointerBuildIdByMode[mode] === 'string' ? pointerBuildIdByMode[mode] : null;
    if (fromState || fromPointer) {
      buildIdByMode[mode] = fromState || fromPointer;
    }
  }

  const identity = {
    type: identityType,
    snapshotId
  };
  if (tag) identity.tag = tag;
  if (Object.keys(buildIdByMode).length) identity.buildIdByMode = buildIdByMode;
  if (Object.keys(metadata.configHashByMode).length) identity.configHashByMode = metadata.configHashByMode;
  if (Object.keys(metadata.toolVersionByMode).length) identity.toolVersionByMode = metadata.toolVersionByMode;

  return {
    indexBaseRootByMode,
    identity,
    snapshot: {
      snapshotId,
      manifestEntry: entry,
      snapshot: snapshotJson
    }
  };
};

const resolveTag = ({
  repoCacheRoot,
  buildsRoot,
  modes,
  tag,
  preferFrozen,
  allowMissingModes,
  warnings
}) => {
  const manifest = readJsonFile(path.join(repoCacheRoot, 'snapshots', 'manifest.json'), 'snapshots/manifest.json', { required: true });
  const ids = Array.isArray(manifest?.tags?.[tag]) ? manifest.tags[tag] : [];
  const snapshotId = ids.find((id) => typeof id === 'string' && id.trim());
  if (!snapshotId) {
    throw notFound(`No snapshots found for tag ${tag}.`);
  }
  return resolveSnapshot({
    repoCacheRoot,
    buildsRoot,
    modes,
    snapshotId,
    preferFrozen,
    allowMissingModes,
    warnings,
    identityType: 'tag',
    tag
  });
};

const resolvePathRef = ({ parsed, modes, allowMissingModes, warnings }) => {
  const resolved = path.resolve(parsed.path);
  if (!fs.existsSync(resolved) && !allowMissingModes) {
    throw notFound(`Path ref not found: ${parsed.path}`);
  }
  const indexBaseRootByMode = {};
  for (const mode of modes) {
    indexBaseRootByMode[mode] = resolved;
  }
  warnings.push('Path ref used; identity is not portable across machines');
  const identity = {
    type: 'path',
    pathHash: sha1(resolved)
  };
  return { indexBaseRootByMode, identity, snapshot: null };
};

export function parseIndexRef(ref) {
  const raw = typeof ref === 'string' ? ref : String(ref ?? '');
  const trimmed = raw.trim();
  if (!trimmed) {
    throw invalidRequest('IndexRef cannot be empty.');
  }
  if (trimmed.toLowerCase() === 'latest') {
    return {
      kind: 'latest',
      raw,
      canonical: 'latest'
    };
  }

  const splitIndex = trimmed.indexOf(':');
  if (splitIndex <= 0) {
    throw invalidRequest(`Invalid IndexRef "${trimmed}".`);
  }

  const prefix = trimmed.slice(0, splitIndex).toLowerCase();
  const value = trimmed.slice(splitIndex + 1);
  if (!value || !value.trim()) {
    throw invalidRequest(`Invalid IndexRef "${trimmed}": missing value.`);
  }

  if (prefix === 'build') {
    if (!BUILD_ID_RE.test(value)) {
      throw invalidRequest(`Invalid build id "${value}".`);
    }
    return { kind: 'build', raw, canonical: `build:${value}`, buildId: value };
  }
  if (prefix === 'snap') {
    if (!SNAPSHOT_ID_RE.test(value)) {
      throw invalidRequest(`Invalid snapshot id "${value}".`);
    }
    return { kind: 'snapshot', raw, canonical: `snap:${value}`, snapshotId: value };
  }
  if (prefix === 'tag') {
    if (!TAG_RE.test(value)) {
      throw invalidRequest(`Invalid tag "${value}".`);
    }
    return { kind: 'tag', raw, canonical: `tag:${value}`, tag: value };
  }
  if (prefix === 'path') {
    return { kind: 'path', raw, canonical: `path:${value}`, path: value };
  }

  throw invalidRequest(`Invalid IndexRef prefix "${prefix}".`);
}

export function redactIndexRefForPersistence(refOrParsed, options = {}) {
  const parsed = typeof refOrParsed === 'string' ? parseIndexRef(refOrParsed) : refOrParsed;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') {
    throw invalidRequest('Invalid IndexRef payload for persistence.');
  }
  if (parsed.kind !== 'path') {
    return {
      ref: parsed.canonical,
      redacted: false,
      pathHash: null
    };
  }
  if (options.persistUnsafe !== true) {
    throw invalidRequest('Path refs cannot be persisted without --persist-unsafe.');
  }
  const pathHash = sha1(path.resolve(parsed.path));
  return {
    ref: 'path:<redacted>',
    redacted: true,
    pathHash
  };
}

export function resolveIndexRef(input = {}) {
  const {
    ref = 'latest',
    parsed = null,
    repoRoot,
    userConfig = null,
    requestedModes = [],
    preferFrozen = true,
    allowMissingModes = false
  } = input;
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw invalidRequest('resolveIndexRef requires repoRoot.');
  }

  const effectiveParsed = parsed || parseIndexRef(ref);
  const modes = normalizeRequestedModes(requestedModes);
  const repoRootResolved = path.resolve(repoRoot);
  const repoCacheRoot = getRepoCacheRoot(repoRootResolved, userConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const warnings = [];

  let resolved = null;
  if (effectiveParsed.kind === 'latest') {
    resolved = resolveLatest({
      repoCacheRoot,
      buildsRoot,
      modes,
      allowMissingModes: Boolean(allowMissingModes),
      warnings
    });
  } else if (effectiveParsed.kind === 'build') {
    resolved = resolveBuild({
      repoCacheRoot,
      buildsRoot,
      modes,
      buildId: effectiveParsed.buildId,
      allowMissingModes: Boolean(allowMissingModes),
      warnings
    });
  } else if (effectiveParsed.kind === 'snapshot') {
    resolved = resolveSnapshot({
      repoCacheRoot,
      buildsRoot,
      modes,
      snapshotId: effectiveParsed.snapshotId,
      preferFrozen: Boolean(preferFrozen),
      allowMissingModes: Boolean(allowMissingModes),
      warnings
    });
  } else if (effectiveParsed.kind === 'tag') {
    resolved = resolveTag({
      repoCacheRoot,
      buildsRoot,
      modes,
      tag: effectiveParsed.tag,
      preferFrozen: Boolean(preferFrozen),
      allowMissingModes: Boolean(allowMissingModes),
      warnings
    });
  } else if (effectiveParsed.kind === 'path') {
    resolved = resolvePathRef({
      parsed: effectiveParsed,
      modes,
      allowMissingModes: Boolean(allowMissingModes),
      warnings
    });
  } else {
    throw invalidRequest(`Unsupported IndexRef kind "${effectiveParsed.kind}".`);
  }

  return finalizeResolved({
    requested: typeof ref === 'string' ? ref : effectiveParsed.canonical,
    parsed: effectiveParsed,
    indexBaseRootByMode: resolved.indexBaseRootByMode,
    identity: resolved.identity,
    snapshot: resolved.snapshot,
    warnings
  });
}
