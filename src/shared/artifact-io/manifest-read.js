import path from 'node:path';
import { MAX_JSON_BYTES } from './constants.js';
import { existsOrBak } from './fs.js';
import { readJsonFile } from './json.js';
import { readCache, writeCache } from './cache.js';
import { getTestEnvConfig } from '../env/testing.js';
import { logLine } from '../progress-runtime.js';

const MIN_MANIFEST_BYTES = 64 * 1024;
const warnedMissingCompat = new Set();
const warnedMissingManifest = new Set();
const DEFAULT_STRICT_MANIFEST_RETRY_DELAYS_MS = Object.freeze([25, 50]);

const normalizeManifest = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw.fields && typeof raw.fields === 'object' ? raw.fields : raw;
  const pieces = Array.isArray(source.pieces) ? source.pieces : [];
  return { ...source, pieces };
};

const normalizeCompatibilityKey = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const resolveManifestMaxBytes = (maxBytes, { strict = true } = {}) => {
  if (maxBytes == null) return maxBytes;
  if (typeof maxBytes !== 'number' || !Number.isFinite(maxBytes)) {
    if (strict) {
      const err = new Error('manifest maxBytes must be a finite number.');
      err.code = 'ERR_MANIFEST_MAX_BYTES';
      throw err;
    }
    return undefined;
  }
  if (maxBytes <= 0) {
    if (strict) {
      const err = new Error('manifest maxBytes must be greater than zero.');
      err.code = 'ERR_MANIFEST_MAX_BYTES';
      throw err;
    }
    return undefined;
  }
  const parsed = Math.floor(maxBytes);
  return Math.max(Math.floor(parsed), MIN_MANIFEST_BYTES);
};

export const loadPiecesManifest = (dir, { maxBytes = MAX_JSON_BYTES, strict = true } = {}) => {
  const manifestPath = path.join(dir, 'pieces', 'manifest.json');
  if (!existsOrBak(manifestPath)) {
    if (strict) {
      const err = new Error(`Missing pieces manifest: ${manifestPath}`);
      err.code = 'ERR_MANIFEST_MISSING';
      throw err;
    }
    if (!warnedMissingManifest.has(manifestPath)) {
      warnedMissingManifest.add(manifestPath);
      logLine(
        `[manifest] Non-strict mode: missing pieces manifest; falling back to legacy paths (${manifestPath}).`,
        { kind: 'warning' }
      );
    }
    return null;
  }
  const resolvedMaxBytes = resolveManifestMaxBytes(maxBytes, { strict });
  const cached = readCache(manifestPath);
  if (cached) return cached;
  const raw = readJsonFile(manifestPath, { maxBytes: resolvedMaxBytes });
  const manifest = normalizeManifest(raw);
  if (!manifest && strict) {
    const err = new Error(`Invalid pieces manifest: ${manifestPath}`);
    err.code = 'ERR_MANIFEST_INVALID';
    throw err;
  }
  if (manifest) {
    writeCache(manifestPath, manifest);
  }
  return manifest;
};

export const resolvePiecesManifestReadPlan = ({
  manifest = null,
  maxBytes = MAX_JSON_BYTES,
  strict = true,
  retryDelaysMs = DEFAULT_STRICT_MANIFEST_RETRY_DELAYS_MS
} = {}) => {
  if (manifest && typeof manifest === 'object') {
    return Object.freeze({
      manifest,
      maxBytes: resolveManifestMaxBytes(maxBytes, { strict }),
      strict: Boolean(strict),
      attempts: Object.freeze([]),
      retryableCodes: Object.freeze([])
    });
  }
  const strictMode = strict !== false;
  const normalizedMaxBytes = resolveManifestMaxBytes(maxBytes, { strict: strictMode });
  const delays = strictMode
    ? (Array.isArray(retryDelaysMs) ? retryDelaysMs : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .map((value) => Math.floor(value))
    : [];
  const attempts = strictMode ? [0, ...delays] : [0];
  return Object.freeze({
    manifest: null,
    maxBytes: normalizedMaxBytes,
    strict: strictMode,
    attempts: Object.freeze(attempts),
    retryableCodes: Object.freeze(strictMode ? ['ERR_MANIFEST_MISSING'] : [])
  });
};

export const loadPiecesManifestWithReadPlan = async (
  dir,
  options = {}
) => {
  const plan = resolvePiecesManifestReadPlan(options);
  if (plan.manifest) return plan.manifest;
  const readManifest = typeof options.readManifest === 'function'
    ? options.readManifest
    : loadPiecesManifest;
  const sleepImpl = typeof options.sleep === 'function'
    ? options.sleep
    : ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError = null;
  for (let attemptIndex = 0; attemptIndex < plan.attempts.length; attemptIndex += 1) {
    if (attemptIndex > 0) {
      await sleepImpl(plan.attempts[attemptIndex]);
    }
    try {
      return readManifest(dir, { maxBytes: plan.maxBytes, strict: plan.strict });
    } catch (error) {
      lastError = error;
      if (!plan.retryableCodes.includes(error?.code) || attemptIndex >= plan.attempts.length - 1) {
        throw error;
      }
    }
  }
  if (lastError) throw lastError;
  return null;
};

export const readCompatibilityKey = (dir, { maxBytes = MAX_JSON_BYTES, strict = true } = {}) => {
  const testEnv = getTestEnvConfig();
  const allowMissingInTests = testEnv.testing && testEnv.allowMissingCompatKey !== false;
  let manifest = null;
  if (strict) {
    manifest = loadPiecesManifest(dir, { maxBytes, strict: true });
  } else {
    try {
      manifest = loadPiecesManifest(dir, { maxBytes, strict: false });
    } catch {}
  }
  const manifestKey = normalizeCompatibilityKey(manifest?.compatibilityKey);
  if (manifestKey) {
    return { key: manifestKey, source: 'manifest' };
  }
  const statePath = path.join(dir, 'index_state.json');
  let state = null;
  try {
    state = readJsonFile(statePath, { maxBytes });
  } catch (err) {
    if (strict) {
      if (allowMissingInTests) {
        if (!warnedMissingCompat.has(dir)) {
          warnedMissingCompat.add(dir);
          logLine(`Missing compatibilityKey for index; continuing because tests allow missing keys: ${dir}`, { kind: 'warning' });
        }
        return { key: null, source: null };
      }
      const error = new Error(`Missing compatibilityKey for index: ${dir}`);
      error.code = 'ERR_COMPATIBILITY_KEY_MISSING';
      throw error;
    }
    return { key: null, source: null };
  }
  const stateKey = normalizeCompatibilityKey(state?.compatibilityKey);
  if (stateKey) {
    if (manifest && strict) {
      logLine(
        `Pieces manifest missing compatibilityKey; falling back to index_state.json (${path.join(dir, 'pieces', 'manifest.json')}).`,
        { kind: 'warning' }
      );
    }
    return { key: stateKey, source: 'index_state' };
  }
  if (strict) {
    if (allowMissingInTests) {
      if (!warnedMissingCompat.has(dir)) {
        warnedMissingCompat.add(dir);
        logLine(`Missing compatibilityKey for index; continuing because tests allow missing keys: ${dir}`, { kind: 'warning' });
      }
      return { key: null, source: null };
    }
    const err = new Error(`Missing compatibilityKey for index: ${dir}`);
    err.code = 'ERR_COMPATIBILITY_KEY_MISSING';
    throw err;
  }
  return { key: null, source: null };
};
