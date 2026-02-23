import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeBundleFormat } from '../../../shared/bundle-io.js';
import { SIGNATURE_VERSION } from '../indexer/signatures.js';
import { pathExists } from './shared.js';

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
    files: {},
    shards: null
  };
  if (enabled && await pathExists(manifestPath)) {
    try {
      const loaded = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      if (loaded && typeof loaded === 'object') {
        const loadedKey = typeof loaded.tokenizationKey === 'string'
          ? loaded.tokenizationKey
          : null;
        const loadedSignature = typeof loaded.cacheSignature === 'string'
          ? loaded.cacheSignature
          : null;
        const loadedBundleFormat = normalizeBundleFormat(loaded.bundleFormat);
        const effectiveBundleFormat = requestedBundleFormat || loadedBundleFormat || defaultBundleFormat;
        const loadedSignatureVersion = Number.isFinite(Number(loaded.signatureVersion))
          ? Number(loaded.signatureVersion)
          : null;
        const signatureMismatch = cacheSignature
          ? cacheSignature !== loadedSignature
          : false;
        const signatureVersionMismatch = loadedSignatureVersion !== SIGNATURE_VERSION;
        if (
          signatureMismatch
          || signatureVersionMismatch
          || (tokenizationKey && loadedKey !== tokenizationKey)
        ) {
          if (typeof log === 'function') {
            const reason = signatureVersionMismatch
              ? `signatureVersion mismatch (${loadedSignatureVersion ?? 'none'} -> ${SIGNATURE_VERSION})`
              : (signatureMismatch ? 'signature changed' : 'tokenization config changed');
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
            files: loaded.files || {},
            shards: loaded.shards || null
          };
          if (requestedBundleFormat && loadedBundleFormat !== requestedBundleFormat && typeof log === 'function') {
            log(`[incremental] ${mode} bundle format updated: ${loadedBundleFormat} -> ${requestedBundleFormat}.`);
          }
        }
      }
    } catch {}
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
  if (process.platform === 'win32') {
    const outRootLower = outRoot.toLowerCase();
    const outRootPrefix = `${outRootLower}${path.sep}`;
    return (candidatePath) => {
      const resolvedLower = path.resolve(candidatePath).toLowerCase();
      return resolvedLower === outRootLower || resolvedLower.startsWith(outRootPrefix);
    };
  }
  const outRootPrefix = `${outRoot}${path.sep}`;
  return (candidatePath) => {
    const resolvedPath = path.resolve(candidatePath);
    return resolvedPath === outRoot || resolvedPath.startsWith(outRootPrefix);
  };
};

/**
 * Read and parse a JSON file into an object.
 *
 * @param {string} filePath
 * @returns {Promise<unknown>}
 */
const readJsonFile = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

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
      readJsonFile(indexStatePath),
      readJsonFile(piecesPath)
    ]);
  } catch {
    return fail('failed to read index state/manifest');
  }
  if (!stageSatisfied(stage, indexState?.stage || null)) {
    return fail('index stage mismatch');
  }
  if (!Array.isArray(pieceManifest?.pieces) || pieceManifest.pieces.length === 0) {
    return fail('piece manifest empty');
  }
  const isWithinOutDir = createOutDirContainmentCheck(outDir);
  for (const piece of pieceManifest.pieces) {
    const relPath = typeof piece?.path === 'string' ? piece.path : null;
    if (!relPath) {
      return fail('piece manifest missing path');
    }
    const resolvedPath = path.resolve(outDir, relPath);
    if (!isWithinOutDir(resolvedPath)) {
      return fail('piece manifest path escapes output dir');
    }
    if (!(await pathExists(resolvedPath))) {
      return fail(`piece missing: ${relPath}`);
    }
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
