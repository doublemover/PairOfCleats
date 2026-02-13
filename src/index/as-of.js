import { createError, ERROR_CODES } from '../shared/error-codes.js';
import { parseIndexRef, resolveIndexRef } from './index-ref.js';

const invalidRequest = (message, details = null) => createError(ERROR_CODES.INVALID_REQUEST, message, details);

const normalizeString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeSnapshotRef = (snapshot) => {
  const value = normalizeString(snapshot);
  if (!value) return null;
  if (value.toLowerCase().startsWith('snap:')) {
    const suffix = value.slice(5).trim();
    if (!suffix) {
      throw invalidRequest('Invalid --snapshot value.');
    }
    return `snap:${suffix}`;
  }
  return `snap:${value}`;
};

const cloneObject = (value) => {
  if (!value || typeof value !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
};

export function normalizeAsOfInput({ asOf = null, snapshot = null, defaultRef = 'latest' } = {}) {
  const asOfValue = normalizeString(asOf);
  const snapshotRef = normalizeSnapshotRef(snapshot);
  if (asOfValue && snapshotRef) {
    const parsedAsOf = parseIndexRef(asOfValue);
    const parsedSnapshot = parseIndexRef(snapshotRef);
    if (parsedAsOf.canonical !== parsedSnapshot.canonical) {
      throw invalidRequest(`Conflicting --as-of (${parsedAsOf.canonical}) and --snapshot (${parsedSnapshot.canonical}) values.`);
    }
    return {
      provided: true,
      fromSnapshotAlias: false,
      inputRef: parsedAsOf.canonical
    };
  }
  if (asOfValue) {
    return {
      provided: true,
      fromSnapshotAlias: false,
      inputRef: asOfValue
    };
  }
  if (snapshotRef) {
    return {
      provided: true,
      fromSnapshotAlias: true,
      inputRef: snapshotRef
    };
  }
  return {
    provided: false,
    fromSnapshotAlias: false,
    inputRef: defaultRef
  };
}

const buildSummary = (resolved) => {
  const identity = resolved?.identity && typeof resolved.identity === 'object'
    ? resolved.identity
    : {};
  const summary = {
    type: typeof identity.type === 'string'
      ? identity.type
      : (resolved?.parsed?.kind || 'latest')
  };
  if (typeof identity.snapshotId === 'string' && identity.snapshotId) {
    summary.snapshotId = identity.snapshotId;
  }
  if (typeof identity.tag === 'string' && identity.tag) {
    summary.tag = identity.tag;
  }
  if (identity.buildIdByMode && typeof identity.buildIdByMode === 'object') {
    summary.buildIdByMode = cloneObject(identity.buildIdByMode);
  }
  if (identity.configHashByMode && typeof identity.configHashByMode === 'object') {
    summary.configHashByMode = cloneObject(identity.configHashByMode);
  }
  if (identity.toolVersionByMode && typeof identity.toolVersionByMode === 'object') {
    summary.toolVersionByMode = cloneObject(identity.toolVersionByMode);
  }
  return summary;
};

export function resolveAsOfContext({
  repoRoot,
  userConfig = null,
  requestedModes = [],
  asOf = null,
  snapshot = null,
  preferFrozen = true,
  allowMissingModesForLatest = true
} = {}) {
  const normalized = normalizeAsOfInput({ asOf, snapshot, defaultRef: 'latest' });
  const parsedInput = parseIndexRef(normalized.inputRef);
  const strictInput = normalized.provided && parsedInput.kind !== 'latest';
  try {
    const resolved = resolveIndexRef({
      ref: normalized.inputRef,
      repoRoot,
      userConfig,
      requestedModes,
      preferFrozen,
      allowMissingModes: strictInput ? false : allowMissingModesForLatest === true
    });
    const strictRef = normalized.provided && resolved.canonical !== 'latest';
    return {
      provided: normalized.provided,
      strict: strictRef,
      fromSnapshotAlias: normalized.fromSnapshotAlias,
      inputRef: normalized.inputRef,
      ref: resolved.canonical,
      type: buildSummary(resolved).type,
      identityHash: resolved.identityHash,
      identityHashShort: String(resolved.identityHash || '').slice(0, 8),
      summary: buildSummary(resolved),
      warnings: Array.isArray(resolved.warnings) ? [...resolved.warnings] : [],
      resolved,
      indexBaseRootByMode: { ...(resolved.indexBaseRootByMode || {}) },
      indexDirByMode: { ...(resolved.indexDirByMode || {}) },
      unresolved: false
    };
  } catch (err) {
    if (strictInput || allowMissingModesForLatest !== true) {
      throw err;
    }
    return {
      provided: false,
      strict: false,
      fromSnapshotAlias: false,
      inputRef: 'latest',
      ref: 'latest',
      type: 'latest',
      identityHash: 'latest-unresolved',
      identityHashShort: 'latest-u',
      summary: { type: 'latest' },
      warnings: [err?.message || 'Unable to resolve latest index ref.'],
      resolved: null,
      indexBaseRootByMode: {},
      indexDirByMode: {},
      unresolved: true
    };
  }
}

export function resolveSingleRootForModes(indexBaseRootByMode, modes = []) {
  const roots = [];
  const seen = new Set();
  for (const mode of Array.isArray(modes) ? modes : []) {
    const root = indexBaseRootByMode?.[mode];
    if (typeof root !== 'string' || !root) continue;
    if (seen.has(root)) continue;
    seen.add(root);
    roots.push(root);
  }
  return {
    roots,
    root: roots.length === 1 ? roots[0] : null,
    mixed: roots.length > 1
  };
}
