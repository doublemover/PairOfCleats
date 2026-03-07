import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BUNDLE_CHECKSUM_SCHEMA_VERSION,
  normalizeBundleFormat
} from '../../../shared/bundle-io.js';
import { isWithinRoot, toRealPathSync } from '../../../workspace/identity.js';
import { SIGNATURE_VERSION } from '../indexer/signatures.js';
import { pathExists } from './shared.js';

const INCREMENTAL_MANIFEST_JSON_MAX_BYTES = 8 * 1024 * 1024;
const INCREMENTAL_INDEX_STATE_JSON_MAX_BYTES = 8 * 1024 * 1024;
const INCREMENTAL_PIECES_MANIFEST_JSON_MAX_BYTES = 16 * 1024 * 1024;
const PIECE_VALIDATION_CONCURRENCY = 32;

/**
 * Summarize changed signature keys for incremental-cache reset diagnostics.
 *
 * @param {object|null} current
 * @param {object|null} previous
 * @param {number} [limit=5]
 * @returns {string|null}
 */
const summarizeSignatureDelta = (current, previous, limit = 5) => {
  if (!current || !previous) return null;
  const keys = new Set([
    ...Object.keys(current || {}),
    ...Object.keys(previous || {})
  ]);
  if (!keys.size) return null;
  const sorted = Array.from(keys).sort();
  const diffList = [];
  let diffCount = 0;
  for (const key of sorted) {
    if (current[key] === previous[key]) continue;
    diffCount += 1;
    if (diffList.length < limit) diffList.push(key);
  }
  if (!diffCount) return null;
  const extra = diffCount > diffList.length ? ` (+${diffCount - diffList.length} more)` : '';
  return `${diffList.join(', ')}${extra}`;
};

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const mapWithConcurrency = async (items, concurrency, worker) => {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const out = new Array(list.length);
  const workerCount = Math.max(1, Math.min(list.length, toPositiveInt(concurrency, 1)));
  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) break;
      out[index] = await worker(list[index], index);
    }
  });
  await Promise.all(workers);
  return out;
};

/**
 * Initialize incremental cache state for a mode.
 * @param {{repoCacheRoot:string,mode:'code'|'prose',enabled:boolean,tokenizationKey?:string,log?:(msg:string)=>void}} input
 * @returns {Promise<{enabled:boolean,incrementalDir:string,bundleDir:string,manifestPath:string,manifest:object}>}
 */
export async function loadIncrementalState({
  repoCacheRoot,
  mode,
  enabled,
  tokenizationKey = null,
  cacheSignature = null,
  cacheSignatureSummary = null,
  bundleFormat = null,
  log = null
}) {
  const incrementalDir = path.join(repoCacheRoot, 'incremental', mode);
  const bundleDir = path.join(incrementalDir, 'files');
  const manifestPath = path.join(incrementalDir, 'manifest.json');
  const requestedBundleFormat = typeof bundleFormat === 'string'
    ? normalizeBundleFormat(bundleFormat)
    : null;
  const defaultBundleFormat = requestedBundleFormat || 'json';
  let manifest = {
    version: 5,
    signatureVersion: SIGNATURE_VERSION,
    mode,
    tokenizationKey: tokenizationKey || null,
    cacheSignature: cacheSignature || null,
    signatureSummary: cacheSignatureSummary || null,
    bundleFormat: defaultBundleFormat,
    bundleChecksumSchemaVersion: BUNDLE_CHECKSUM_SCHEMA_VERSION,
    files: {},
    shards: null
  };
  if (enabled && await pathExists(manifestPath)) {
    try {
      const loaded = await readJsonFile(manifestPath, {
        maxBytes: INCREMENTAL_MANIFEST_JSON_MAX_BYTES,
        label: `${mode} incremental manifest`
      });
      if (loaded && typeof loaded === 'object') {
        const loadedKey = typeof loaded.tokenizationKey === 'string'
          ? loaded.tokenizationKey
          : null;
        const loadedSignature = typeof loaded.cacheSignature === 'string'
          ? loaded.cacheSignature
          : null;
        const loadedBundleFormat = normalizeBundleFormat(loaded.bundleFormat);
        const loadedBundleChecksumSchemaVersion = Number(
          loaded.bundleChecksumSchemaVersion
        );
        const effectiveBundleFormat = requestedBundleFormat || loadedBundleFormat || defaultBundleFormat;
        const loadedSignatureVersion = Number.isFinite(Number(loaded.signatureVersion))
          ? Number(loaded.signatureVersion)
          : null;
        const signatureMismatch = cacheSignature
          ? cacheSignature !== loadedSignature
          : false;
        const signatureVersionMismatch = loadedSignatureVersion !== SIGNATURE_VERSION;
        const bundleChecksumSchemaMismatch = loadedBundleChecksumSchemaVersion !== BUNDLE_CHECKSUM_SCHEMA_VERSION;
        if (
          signatureMismatch
          || signatureVersionMismatch
          || bundleChecksumSchemaMismatch
          || (tokenizationKey && loadedKey !== tokenizationKey)
        ) {
          if (typeof log === 'function') {
            let reason = 'tokenization config changed';
            if (signatureVersionMismatch) {
              reason = `signatureVersion mismatch (${loadedSignatureVersion ?? 'none'} -> ${SIGNATURE_VERSION})`;
            } else if (signatureMismatch) {
              reason = 'signature changed';
            } else if (bundleChecksumSchemaMismatch) {
              reason = (
                `bundle checksum schema mismatch ` +
                `(${loadedBundleChecksumSchemaVersion || 'none'} -> ${BUNDLE_CHECKSUM_SCHEMA_VERSION})`
              );
            }
            log(`[incremental] ${mode} cache reset: ${reason}.`);
            if (signatureMismatch && cacheSignatureSummary && loaded.signatureSummary) {
              const diff = summarizeSignatureDelta(cacheSignatureSummary, loaded.signatureSummary);
              if (diff) {
                log(`[incremental] ${mode} signature delta keys: ${diff}.`);
              }
            }
          }
        } else {
          manifest = {
            version: loaded.version || 1,
            signatureVersion: loadedSignatureVersion ?? SIGNATURE_VERSION,
            mode,
            tokenizationKey: loadedKey || tokenizationKey || null,
            cacheSignature: loadedSignature || cacheSignature || null,
            signatureSummary: loaded.signatureSummary || cacheSignatureSummary || null,
            bundleFormat: effectiveBundleFormat,
            bundleChecksumSchemaVersion: BUNDLE_CHECKSUM_SCHEMA_VERSION,
            files: loaded.files || {},
            shards: loaded.shards || null
          };
          if (requestedBundleFormat && loadedBundleFormat !== requestedBundleFormat && typeof log === 'function') {
            log(`[incremental] ${mode} bundle format updated: ${loadedBundleFormat} -> ${requestedBundleFormat}.`);
          }
        }
      }
    } catch (error) {
      if (typeof log === 'function') {
        log(
          `[incremental] ${mode} cache manifest read failed ` +
          `(${error?.code || 'ERR_INCREMENTAL_MANIFEST_READ'}): ${error?.message || error}.`
        );
      }
      await quarantineCorruptJsonFile(manifestPath, {
        label: `${mode} incremental manifest`,
        log
      });
    }
  }
  if (enabled) {
    await fs.mkdir(bundleDir, { recursive: true });
  }
  return {
    enabled,
    incrementalDir,
    bundleDir,
    manifestPath,
    manifest,
    bundleFormat: manifest.bundleFormat,
    readHashCache: new Map()
  };
}

const STAGE_ORDER = {
  stage1: 1,
  stage2: 2,
  stage3: 3,
  stage4: 4
};

/**
 * Check whether existing manifest stage is at least as complete as requested.
 *
 * @param {string|null} requested
 * @param {string|null} existing
 * @returns {boolean}
 */
const stageSatisfied = (requested, existing) => {
  if (!requested) return true;
  const target = STAGE_ORDER[requested] || 0;
  const current = STAGE_ORDER[existing] || 0;
  return current >= target;
};

/**
 * Build a path containment predicate bounded to the output directory root.
 *
 * @param {string} outDir
 * @returns {(candidatePath:string)=>boolean}
 */
const createOutDirContainmentCheck = (outDir) => {
  const outRoot = path.resolve(outDir);
  const outRootCanonical = toRealPathSync(outRoot);
  return (candidatePath, { canonical = false } = {}) => {
    const resolvedPath = path.resolve(candidatePath);
    if (!isWithinRoot(resolvedPath, outRoot)) return false;
    if (!canonical) return true;
    return isWithinRoot(toRealPathSync(resolvedPath), outRootCanonical);
  };
};

const quarantineCorruptJsonFile = async (filePath, { label = 'json', log = null } = {}) => {
  try {
    const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
    await fs.rename(filePath, quarantinePath);
    if (typeof log === 'function') {
      log(`[incremental] quarantined ${label}: ${quarantinePath}`);
    }
    return quarantinePath;
  } catch (error) {
    if (typeof log === 'function') {
      log(
        `[incremental] failed to quarantine ${label} (${filePath}): ` +
        `${error?.message || error}`
      );
    }
    return null;
  }
};

/**
 * Read and parse a JSON file into an object.
 *
 * @param {string} filePath
 * @param {{maxBytes?:number,label?:string}} [options]
 * @returns {Promise<unknown>}
 */
const readJsonFile = async (filePath, { maxBytes = 0, label = 'json' } = {}) => {
  const resolvedMaxBytes = Number(maxBytes);
  if (Number.isFinite(resolvedMaxBytes) && resolvedMaxBytes > 0) {
    const stat = await fs.stat(filePath);
    if (Number.isFinite(Number(stat?.size)) && Number(stat.size) > resolvedMaxBytes) {
      const err = new Error(
        `[incremental] ${label} exceeded maxBytes (${stat.size} > ${resolvedMaxBytes})`
      );
      err.code = 'ERR_INCREMENTAL_JSON_OVERSIZE';
      throw err;
    }
  }
  const raw = await fs.readFile(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    const err = new Error(
      `[incremental] failed to parse ${label}: ${error?.message || error}`,
      { cause: error }
    );
    err.code = 'ERR_INCREMENTAL_JSON_PARSE';
    throw err;
  }
};

/**
 * Decide whether an incremental index can be reused for the current build.
 * @param {{outDir:string,entries:Array<{rel:string}>,manifest:object,stage?:string,log?:(msg:string)=>void,explain?:boolean}} input
 * @returns {Promise<boolean>}
 */
export async function shouldReuseIncrementalIndex({
  outDir,
  entries,
  manifest,
  stage,
  log = null,
  explain = false
}) {
  const shouldExplain = explain === true && typeof log === 'function';
  /**
   * Emit explanatory reuse rejection reason when `explain` mode is enabled.
   *
   * @param {string} reason
   * @returns {false}
   */
  const fail = (reason) => {
    if (shouldExplain) log(`[incremental] reuse skipped: ${reason}.`);
    return false;
  };
  if (!outDir || !manifest || !Array.isArray(entries) || entries.length === 0) {
    return fail('missing build outputs or entries');
  }
  if (manifest.signatureVersion !== SIGNATURE_VERSION) {
    return fail('signatureVersion mismatch');
  }
  const manifestFiles = manifest.files || {};
  const indexStatePath = path.join(outDir, 'index_state.json');
  const piecesPath = path.join(outDir, 'pieces', 'manifest.json');
  const [indexStateExists, piecesExists] = await Promise.all([
    pathExists(indexStatePath),
    pathExists(piecesPath)
  ]);
  if (!indexStateExists || !piecesExists) {
    return fail('missing index artifacts');
  }
  let indexState = null;
  let pieceManifest = null;
  try {
    [indexState, pieceManifest] = await Promise.all([
      readJsonFile(indexStatePath, {
        maxBytes: INCREMENTAL_INDEX_STATE_JSON_MAX_BYTES,
        label: 'index state'
      }),
      readJsonFile(piecesPath, {
        maxBytes: INCREMENTAL_PIECES_MANIFEST_JSON_MAX_BYTES,
        label: 'pieces manifest'
      })
    ]);
  } catch (error) {
    return fail(`failed to read index state/manifest (${error?.code || 'ERR_JSON_READ'})`);
  }
  if (!stageSatisfied(stage, indexState?.stage || null)) {
    return fail('index stage mismatch');
  }
  if (!Array.isArray(pieceManifest?.pieces) || pieceManifest.pieces.length === 0) {
    return fail('piece manifest empty');
  }
  const isWithinOutDir = createOutDirContainmentCheck(outDir);
  const pieceErrors = await mapWithConcurrency(
    pieceManifest.pieces,
    PIECE_VALIDATION_CONCURRENCY,
    async (piece) => {
      const relPath = typeof piece?.path === 'string' ? piece.path : null;
      if (!relPath) {
        return 'piece manifest missing path';
      }
      const resolvedPath = path.resolve(outDir, relPath);
      if (!isWithinOutDir(resolvedPath)) {
        return 'piece manifest path escapes output dir';
      }
      if (!(await pathExists(resolvedPath))) {
        return `piece missing: ${relPath}`;
      }
      if (!isWithinOutDir(resolvedPath, { canonical: true })) {
        return 'piece manifest path escapes output dir';
      }
      return null;
    }
  );
  const firstPieceError = pieceErrors.find((entry) => typeof entry === 'string' && entry);
  if (firstPieceError) {
    return fail(firstPieceError);
  }
  const entryKeys = new Set();
  for (const entry of entries) {
    if (entry?.rel) entryKeys.add(entry.rel);
  }
  for (const relKey of Object.keys(manifestFiles)) {
    if (!entryKeys.has(relKey)) {
      return fail('manifest missing entries');
    }
  }
  for (const entry of entries) {
    const relKey = entry?.rel;
    if (!relKey) return fail('missing entry rel path');
    const cached = manifestFiles[relKey];
    if (!cached || !entry.stat) return fail('missing cached entry stats');
    if (cached.size !== entry.stat.size || cached.mtimeMs !== entry.stat.mtimeMs) {
      return fail('entry stats changed');
    }
  }
  return true;
}
