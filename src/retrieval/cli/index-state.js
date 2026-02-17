import fsSync from 'node:fs';
import path from 'node:path';
import { resolveIndexDir } from '../cli-index.js';
import {
  INDEX_PROFILE_DEFAULT,
  INDEX_PROFILE_SCHEMA_VERSION,
  INDEX_STATE_ARTIFACTS_SCHEMA_VERSION,
  normalizeIndexProfileId,
  resolveRequiredArtifactsForProfile
} from '../../contracts/index-profile.js';

export const LEGACY_PROFILE_NORMALIZATION_WARNING = (
  'Legacy index_state.json missing profile metadata; normalizing to profile.id=default. ' +
  'Rebuild indexes to persist profile metadata.'
);

let legacyProfileWarningEmitted = false;

const emitLegacyProfileWarningOnce = (onCompatibilityWarning) => {
  if (legacyProfileWarningEmitted) return;
  legacyProfileWarningEmitted = true;
  if (typeof onCompatibilityWarning === 'function') {
    onCompatibilityWarning(LEGACY_PROFILE_NORMALIZATION_WARNING);
    return;
  }
  console.warn(`[search] ${LEGACY_PROFILE_NORMALIZATION_WARNING}`);
};

export const resetLegacyProfileNormalizationWarningForTests = () => {
  legacyProfileWarningEmitted = false;
};

export const normalizeIndexStateProfile = (state) => {
  const rawProfile = state?.profile && typeof state.profile === 'object'
    ? state.profile
    : null;
  const id = normalizeIndexProfileId(rawProfile?.id, INDEX_PROFILE_DEFAULT);
  const schemaVersion = Number.isFinite(Number(rawProfile?.schemaVersion))
    ? Math.max(1, Math.floor(Number(rawProfile.schemaVersion)))
    : INDEX_PROFILE_SCHEMA_VERSION;
  return { id, schemaVersion };
};

export const normalizeIndexStateArtifacts = (state, profileId) => {
  const rawArtifacts = state?.artifacts && typeof state.artifacts === 'object'
    ? state.artifacts
    : null;
  const rawPresent = rawArtifacts?.present && typeof rawArtifacts.present === 'object'
    ? rawArtifacts.present
    : {};
  const present = {};
  for (const key of Object.keys(rawPresent).sort()) {
    present[key] = rawPresent[key] === true;
  }
  present.index_state = true;
  const requiredForSearch = Array.isArray(rawArtifacts?.requiredForSearch)
    ? Array.from(new Set(rawArtifacts.requiredForSearch.filter((entry) => typeof entry === 'string')))
      .sort((left, right) => left.localeCompare(right))
    : resolveRequiredArtifactsForProfile(profileId);
  const omittedSet = new Set(Array.isArray(rawArtifacts?.omitted) ? rawArtifacts.omitted : []);
  for (const [name, isPresent] of Object.entries(present)) {
    if (isPresent === true) omittedSet.delete(name);
    if (isPresent !== true) omittedSet.add(name);
  }
  const omitted = Array.from(omittedSet)
    .filter((entry) => typeof entry === 'string' && entry)
    .sort((left, right) => left.localeCompare(right));
  const schemaVersion = Number.isFinite(Number(rawArtifacts?.schemaVersion))
    ? Math.max(1, Math.floor(Number(rawArtifacts.schemaVersion)))
    : INDEX_STATE_ARTIFACTS_SCHEMA_VERSION;
  return {
    schemaVersion,
    present,
    omitted,
    requiredForSearch
  };
};

export const normalizeLoadedIndexState = (state, options = {}) => {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
  const hasProfileBlock = state.profile && typeof state.profile === 'object';
  if (!hasProfileBlock) {
    emitLegacyProfileWarningOnce(options.onCompatibilityWarning);
  }
  const profile = normalizeIndexStateProfile(state);
  const artifacts = normalizeIndexStateArtifacts(state, profile.id);
  return {
    ...state,
    profile,
    artifacts
  };
};

export const loadIndexState = (rootDir, userConfig, mode, options = {}) => {
  try {
    const dir = resolveIndexDir(rootDir, mode, userConfig, options.resolveOptions || {});
    const statePath = path.join(dir, 'index_state.json');
    if (!fsSync.existsSync(statePath)) return null;
    const parsed = JSON.parse(fsSync.readFileSync(statePath, 'utf8'));
    return normalizeLoadedIndexState(parsed, options);
  } catch {
    return null;
  }
};

export const isSqliteReady = (state) => {
  if (!state?.sqlite) return true;
  return state.sqlite.ready !== false && state.sqlite.pending !== true;
};

export const isLmdbReady = (state) => {
  if (!state?.lmdb) return true;
  return state.lmdb.ready !== false && state.lmdb.pending !== true;
};
