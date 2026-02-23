import fs from 'node:fs/promises';
import { availableParallelism, cpus } from 'node:os';
import path from 'node:path';
import { sha1 } from '../../shared/hash.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { SIGNATURE_VERSION } from './indexer/signatures.js';
import {
  normalizeBundleFormat,
  readBundleFile,
  resolveBundleFilename,
  resolveBundleFormatFromName,
  writeBundleFile,
  writeBundlePatch
} from '../../shared/bundle-io.js';
import { normalizeFilePath } from '../../shared/path-normalize.js';
import { getEnvConfig } from '../../shared/env.js';
import { isWithinRoot, toRealPathSync } from '../../workspace/identity.js';

const pathExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

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

const isCoarseMtime = (mtimeMs) => (
  Number.isFinite(mtimeMs) && Math.trunc(mtimeMs) % 1000 === 0
);

const shouldVerifyHash = (fileStat, cachedEntry) => (
  isCoarseMtime(fileStat?.mtimeMs) && !!cachedEntry?.hash
);

const MAX_SHARED_HASH_READ_ENTRIES = 256;
const DEFAULT_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY = 12;
const MAX_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY = 64;
const HIGH_VOLUME_INCREMENTAL_BUNDLE_UPDATE_THRESHOLD = 16384;
const MAX_HIGH_VOLUME_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY = 96;
const HOT_CROSS_FILE_BUNDLE_UPDATE_WINDOW_MS = 10 * 60 * 1000;
const ENV_CONFIG = getEnvConfig();

const resolveIncrementalBundleUpdateConcurrency = ({
  totalUpdates,
  cpuIdleRatio = null
}) => {
  const updates = Number.isFinite(Number(totalUpdates)) && totalUpdates > 0
    ? Math.floor(Number(totalUpdates))
    : 1;
  const envRaw = Number(ENV_CONFIG.incrementalBundleUpdateConcurrency);
  if (Number.isFinite(envRaw) && envRaw > 0) {
    return Math.min(updates, Math.max(1, Math.floor(envRaw)));
  }
  const cpuCount = typeof availableParallelism === 'function'
    ? Math.max(1, Math.floor(availableParallelism()))
    : DEFAULT_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY;
  const baseline = Math.max(
    DEFAULT_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY,
    Math.min(MAX_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY, cpuCount * 3)
  );
  let resolved = baseline;
  if (updates >= HIGH_VOLUME_INCREMENTAL_BUNDLE_UPDATE_THRESHOLD) {
    const highVolume = Math.max(
      baseline,
      Math.min(MAX_HIGH_VOLUME_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY, cpuCount * 4)
    );
    resolved = highVolume;
  }
  if (Number.isFinite(cpuIdleRatio)) {
    const idle = Math.max(0, Math.min(1, Number(cpuIdleRatio)));
    if (idle >= 0.5) {
      resolved = Math.min(MAX_HIGH_VOLUME_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY, Math.ceil(resolved * 1.25));
    } else if (idle <= 0.15) {
      resolved = Math.max(DEFAULT_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY, Math.floor(resolved * 0.75));
    }
  }
  return Math.min(updates, resolved);
};

/**
 * Sample system CPU idle ratio over a short interval.
 *
 * @param {number} [sampleMs=40]
 * @returns {Promise<number|null>}
 */
const sampleCpuIdleRatio = async (sampleMs = 40) => {
  try {
    const start = cpus();
    if (!Array.isArray(start) || !start.length) return null;
    await new Promise((resolve) => setTimeout(resolve, Math.max(10, Math.floor(Number(sampleMs) || 40))));
    const end = cpus();
    if (!Array.isArray(end) || end.length !== start.length) return null;
    let idleDelta = 0;
    let totalDelta = 0;
    for (let i = 0; i < start.length; i += 1) {
      const a = start[i]?.times || {};
      const b = end[i]?.times || {};
      const idle = Math.max(0, Number(b.idle || 0) - Number(a.idle || 0));
      const user = Math.max(0, Number(b.user || 0) - Number(a.user || 0));
      const nice = Math.max(0, Number(b.nice || 0) - Number(a.nice || 0));
      const sys = Math.max(0, Number(b.sys || 0) - Number(a.sys || 0));
      const irq = Math.max(0, Number(b.irq || 0) - Number(a.irq || 0));
      const total = idle + user + nice + sys + irq;
      idleDelta += idle;
      totalDelta += total;
    }
    if (!Number.isFinite(totalDelta) || totalDelta <= 0) return null;
    return Math.max(0, Math.min(1, idleDelta / totalDelta));
  } catch {
    return null;
  }
};

const resolveSharedReadCache = (sharedReadState) => (
  sharedReadState instanceof Map ? sharedReadState : null
);

/**
 * Lookup a shared file hash/buffer cache entry when size+mtime still match.
 *
 * @param {Map<string, object>|null} sharedReadState
 * @param {string} relKey
 * @param {{size:number,mtimeMs:number}} fileStat
 * @returns {{size:number,mtimeMs:number,hash:string,buffer:Buffer|null}|null}
 */
const getSharedReadEntry = (sharedReadState, relKey, fileStat) => {
  const cache = resolveSharedReadCache(sharedReadState);
  if (!cache || !relKey) return null;
  const entry = cache.get(relKey);
  if (!entry || typeof entry !== 'object') return null;
  if (entry.size !== fileStat?.size || entry.mtimeMs !== fileStat?.mtimeMs) {
    cache.delete(relKey);
    return null;
  }
  return entry;
};

/**
 * Store a shared hash/buffer entry and evict oldest entries above cap.
 *
 * @param {object} input
 */
const setSharedReadEntry = ({
  sharedReadState,
  relKey,
  fileStat,
  hash,
  buffer = null
}) => {
  const cache = resolveSharedReadCache(sharedReadState);
  if (!cache || !relKey || !fileStat || !hash) return;
  cache.set(relKey, {
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    hash,
    buffer: Buffer.isBuffer(buffer) ? buffer : null
  });
  if (cache.size > MAX_SHARED_HASH_READ_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
};

/**
 * Read file bytes and hash with optional shared-cache reuse.
 * Buffers are retained only when `requireBuffer` is true.
 *
 * @param {object} input
 * @returns {Promise<{hash:string,buffer:Buffer|null}>}
 */
const readFileBufferAndHash = async ({
  absPath,
  relKey,
  fileStat,
  sharedReadState = null,
  requireBuffer = false
}) => {
  const shared = getSharedReadEntry(sharedReadState, relKey, fileStat);
  if (shared) {
    if (!requireBuffer || Buffer.isBuffer(shared.buffer)) {
      return {
        hash: shared.hash,
        buffer: Buffer.isBuffer(shared.buffer) ? shared.buffer : null
      };
    }
  }
  const buffer = await fs.readFile(absPath);
  const hash = sha1(buffer);
  setSharedReadEntry({
    sharedReadState,
    relKey,
    fileStat,
    hash,
    buffer: requireBuffer ? buffer : null
  });
  return {
    hash,
    buffer: requireBuffer ? buffer : null
  };
};

const normalizeIncrementalRelPath = (value) => {
  const normalized = normalizeFilePath(value, { lower: process.platform === 'win32' });
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
};

const resolvePrefetchedVfsRows = (store, normalizedFile, rawFile) => {
  if (store && typeof store.get === 'function') {
    if (store.has(normalizedFile)) {
      return { hit: true, rows: store.get(normalizedFile) || null };
    }
    if (store.has(rawFile)) {
      return { hit: true, rows: store.get(rawFile) || null };
    }
    return { hit: false, rows: null };
  }
  if (store && typeof store === 'object') {
    if (Object.prototype.hasOwnProperty.call(store, normalizedFile)) {
      return { hit: true, rows: store[normalizedFile] || null };
    }
    if (Object.prototype.hasOwnProperty.call(store, rawFile)) {
      return { hit: true, rows: store[rawFile] || null };
    }
  }
  return { hit: false, rows: null };
};

const comparePendingCrossFileBundleUpdates = (a, b) => {
  const aMtime = Number(a?.entry?.mtimeMs) || 0;
  const bMtime = Number(b?.entry?.mtimeMs) || 0;
  if (aMtime !== bMtime) return bMtime - aMtime;
  const aChunks = Array.isArray(a?.fileChunks) ? a.fileChunks.length : 0;
  const bChunks = Array.isArray(b?.fileChunks) ? b.fileChunks.length : 0;
  if (aChunks !== bChunks) return bChunks - aChunks;
  return String(a?.normalizedFile || a?.file || '').localeCompare(String(b?.normalizedFile || b?.file || ''));
};

const isHotPendingCrossFileBundleUpdate = (pendingUpdate, nowMs = Date.now()) => {
  const mtimeMs = Number(pendingUpdate?.entry?.mtimeMs) || 0;
  return mtimeMs > 0 && (nowMs - mtimeMs) <= HOT_CROSS_FILE_BUNDLE_UPDATE_WINDOW_MS;
};

const prioritizePendingCrossFileBundleUpdates = (pendingUpdates, { nowMs = Date.now() } = {}) => {
  const hot = [];
  const cold = [];
  for (const pendingUpdate of pendingUpdates) {
    if (isHotPendingCrossFileBundleUpdate(pendingUpdate, nowMs)) {
      hot.push(pendingUpdate);
    } else {
      cold.push(pendingUpdate);
    }
  }
  hot.sort(comparePendingCrossFileBundleUpdates);
  cold.sort(comparePendingCrossFileBundleUpdates);
  return hot.concat(cold);
};

const buildBundleMetaReuseSignature = (metaV2) => {
  if (!metaV2 || typeof metaV2 !== 'object') return '';
  const selected = {
    chunkId: metaV2.chunkId ?? null,
    file: metaV2.file ?? null,
    range: metaV2.range ?? null,
    lang: metaV2.lang ?? null,
    ext: metaV2.ext ?? null,
    types: metaV2.types ?? null,
    relations: metaV2.relations ?? null,
    segment: metaV2.segment ?? null
  };
  const payload = buildStableJsonSignature(selected);
  return payload ? sha1(payload) : '';
};

const buildChunkReuseSignature = (chunks) => (
  Array.isArray(chunks)
    ? chunks.map((chunk) => {
      const chunkId = chunk?.chunkId || chunk?.chunkUid || '';
      const docId = Number.isFinite(chunk?.id) ? Math.floor(chunk.id) : '';
      const start = Number(chunk?.start) || 0;
      const end = Number(chunk?.end) || 0;
      const hash = typeof chunk?.hash === 'string' ? chunk.hash : '';
      const textLength = typeof chunk?.text === 'string' ? chunk.text.length : 0;
      const metaSignature = buildBundleMetaReuseSignature(chunk?.metaV2);
      return `${chunkId}:${docId}:${start}:${end}:${hash}:${textLength}:${metaSignature}`;
    }).join('|')
    : ''
);

const buildStableJsonSignature = (value) => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return '';
  }
};

const shouldReuseExistingBundle = (existingBundle, nextBundle) => {
  if (!existingBundle || !nextBundle) return false;
  if (existingBundle.hash !== nextBundle.hash) return false;
  if (existingBundle.mtimeMs !== nextBundle.mtimeMs) return false;
  if (existingBundle.size !== nextBundle.size) return false;
  if (buildChunkReuseSignature(existingBundle.chunks) !== buildChunkReuseSignature(nextBundle.chunks)) {
    return false;
  }
  if (buildStableJsonSignature(existingBundle.fileRelations) !== buildStableJsonSignature(nextBundle.fileRelations)) {
    return false;
  }
  if (buildStableJsonSignature(existingBundle.vfsManifestRows) !== buildStableJsonSignature(nextBundle.vfsManifestRows)) {
    return false;
  }
  if ((existingBundle.encoding || null) !== (nextBundle.encoding || null)) return false;
  if ((existingBundle.encodingFallback || null) !== (nextBundle.encodingFallback || null)) return false;
  if ((existingBundle.encodingConfidence || null) !== (nextBundle.encodingConfidence || null)) return false;
  return true;
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

const stageSatisfied = (requested, existing) => {
  if (!requested) return true;
  const target = STAGE_ORDER[requested] || 0;
  const current = STAGE_ORDER[existing] || 0;
  return current >= target;
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
  if (!(await pathExists(indexStatePath)) || !(await pathExists(piecesPath))) {
    return fail('missing index artifacts');
  }
  let indexState = null;
  let pieceManifest = null;
  try {
    indexState = JSON.parse(await fs.readFile(indexStatePath, 'utf8'));
    pieceManifest = JSON.parse(await fs.readFile(piecesPath, 'utf8'));
  } catch {
    return fail('failed to read index state/manifest');
  }
  if (!stageSatisfied(stage, indexState?.stage || null)) {
    return fail('index stage mismatch');
  }
  if (!Array.isArray(pieceManifest?.pieces) || pieceManifest.pieces.length === 0) {
    return fail('piece manifest empty');
  }
  const outRoot = path.resolve(outDir);
  const canonicalOutRoot = toRealPathSync(outRoot);
  for (const piece of pieceManifest.pieces) {
    const relPath = typeof piece?.path === 'string' ? piece.path : null;
    if (!relPath) {
      return fail('piece manifest missing path');
    }
    const resolvedPath = path.resolve(outDir, relPath);
    if (!isWithinRoot(resolvedPath, outRoot)) {
      return fail('piece manifest path escapes output dir');
    }
    const canonicalResolvedPath = toRealPathSync(resolvedPath);
    if (!isWithinRoot(canonicalResolvedPath, canonicalOutRoot)) {
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

/**
 * Attempt to load a cached bundle for a file.
 * @param {{enabled:boolean,absPath:string,relKey:string,fileStat:import('node:fs').Stats,manifest:object,bundleDir:string}} input
 * @returns {Promise<{cachedBundle:object|null,fileHash:string|null,buffer:Buffer|null}>}
 */
export async function readCachedBundle({
  enabled,
  absPath,
  relKey,
  fileStat,
  manifest,
  bundleDir,
  bundleFormat = null,
  sharedReadState = null
}) {
  let cachedBundle = null;
  let fileHash = null;
  let buffer = null;
  if (!enabled) return { cachedBundle, fileHash, buffer };

  const resolvedBundleFormat = normalizeBundleFormat(bundleFormat || manifest?.bundleFormat);
  const cachedEntry = manifest.files[relKey];
  const bundleName = cachedEntry?.bundle || resolveBundleFilename(relKey, resolvedBundleFormat);
  const bundlePath = path.join(bundleDir, bundleName);
  const bundleExists = await pathExists(bundlePath);
  if (cachedEntry && cachedEntry.size === fileStat.size && cachedEntry.mtimeMs === fileStat.mtimeMs && bundleExists) {
    try {
      if (shouldVerifyHash(fileStat, cachedEntry)) {
        const sharedRead = await readFileBufferAndHash({
          absPath,
          relKey,
          fileStat,
          sharedReadState,
          requireBuffer: true
        });
        buffer = sharedRead.buffer;
        fileHash = sharedRead.hash;
        if (fileHash !== cachedEntry.hash) {
          return { cachedBundle, fileHash, buffer };
        }
      }
      const result = await readBundleFile(bundlePath, {
        format: resolveBundleFormatFromName(bundleName, resolvedBundleFormat)
      });
      cachedBundle = result.ok ? result.bundle : null;
    } catch {
      cachedBundle = null;
    }
  } else if (cachedEntry && cachedEntry.hash && bundleExists) {
    try {
      const sharedRead = await readFileBufferAndHash({
        absPath,
        relKey,
        fileStat,
        sharedReadState,
        requireBuffer: true
      });
      buffer = sharedRead.buffer;
      fileHash = sharedRead.hash;
      if (fileHash === cachedEntry.hash) {
        const result = await readBundleFile(bundlePath, {
          format: resolveBundleFormatFromName(bundleName, resolvedBundleFormat)
        });
        cachedBundle = result.ok ? result.bundle : null;
      }
    } catch {
      cachedBundle = null;
    }
  }

  return { cachedBundle, fileHash, buffer };
}

/**
 * Attempt to load cached imports for a file when size/mtime match.
 * @param {{enabled:boolean,absPath:string,relKey:string,fileStat:import('node:fs').Stats,manifest:object,bundleDir:string}} input
 * @returns {Promise<string[]|null>}
 */
export async function readCachedImports({
  enabled,
  absPath,
  relKey,
  fileStat,
  manifest,
  bundleDir,
  bundleFormat = null,
  sharedReadState = null
}) {
  if (!enabled) return null;
  const resolvedBundleFormat = normalizeBundleFormat(bundleFormat || manifest?.bundleFormat);
  const cachedEntry = manifest.files?.[relKey];
  if (!cachedEntry || cachedEntry.size !== fileStat.size || cachedEntry.mtimeMs !== fileStat.mtimeMs) {
    if (!cachedEntry || !cachedEntry.hash) return null;
    const bundleName = cachedEntry.bundle || resolveBundleFilename(relKey, resolvedBundleFormat);
    const bundlePath = path.join(bundleDir, bundleName);
    if (!(await pathExists(bundlePath))) return null;
    try {
      const sharedRead = await readFileBufferAndHash({
        absPath,
        relKey,
        fileStat,
        sharedReadState,
        requireBuffer: false
      });
      const fileHash = sharedRead.hash;
      if (fileHash !== cachedEntry.hash) return null;
      const result = await readBundleFile(bundlePath, {
        format: resolveBundleFormatFromName(bundleName, resolvedBundleFormat)
      });
      if (!result.ok) return null;
      const bundle = result.bundle;
      const imports = bundle?.fileRelations?.imports;
      return Array.isArray(imports) ? imports : null;
    } catch {
      return null;
    }
  }
  if (shouldVerifyHash(fileStat, cachedEntry)) {
    try {
      const sharedRead = await readFileBufferAndHash({
        absPath,
        relKey,
        fileStat,
        sharedReadState,
        requireBuffer: false
      });
      const fileHash = sharedRead.hash;
      if (fileHash !== cachedEntry.hash) return null;
    } catch {
      return null;
    }
  }
  const bundleName = cachedEntry.bundle || resolveBundleFilename(relKey, resolvedBundleFormat);
  const bundlePath = path.join(bundleDir, bundleName);
  if (!(await pathExists(bundlePath))) return null;
  try {
    const result = await readBundleFile(bundlePath, {
      format: resolveBundleFormatFromName(bundleName, resolvedBundleFormat)
    });
    if (!result.ok) return null;
    const bundle = result.bundle;
    const imports = bundle?.fileRelations?.imports;
    return Array.isArray(imports) ? imports : null;
  } catch {
    return null;
  }
}

/**
 * Write bundle and return manifest entry.
 * @param {{enabled:boolean,bundleDir:string,relKey:string,fileStat:import('node:fs').Stats,fileHash:string,fileChunks:object[],fileRelations:object|null}} input
 * @returns {Promise<object|null>}
 */
export async function writeIncrementalBundle({
  enabled,
  bundleDir,
  relKey,
  fileStat,
  fileHash,
  fileChunks,
  fileRelations,
  vfsManifestRows,
  bundleFormat = null,
  fileEncoding = null,
  fileEncodingFallback = null,
  fileEncodingConfidence = null
}) {
  if (!enabled) return null;
  const resolvedBundleFormat = normalizeBundleFormat(bundleFormat);
  const bundleName = resolveBundleFilename(relKey, resolvedBundleFormat);
  const bundlePath = path.join(bundleDir, bundleName);
  const bundle = {
    file: relKey,
    hash: fileHash,
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    chunks: fileChunks,
    fileRelations,
    vfsManifestRows: Array.isArray(vfsManifestRows) ? vfsManifestRows : null,
    encoding: fileEncoding,
    encodingFallback: typeof fileEncodingFallback === 'boolean' ? fileEncodingFallback : null,
    encodingConfidence: Number.isFinite(fileEncodingConfidence) ? fileEncodingConfidence : null
  };
  try {
    const writeResult = await writeBundleFile({
      bundlePath,
      bundle,
      format: resolvedBundleFormat
    });
    const checksum = writeResult.checksum;
    const checksumAlgo = writeResult.checksumAlgo;
    const bundleChecksum = checksum && checksumAlgo
      ? `${checksumAlgo}:${checksum}`
      : (checksum || null);
    return {
      hash: fileHash,
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      bundle: path.basename(bundlePath),
      bundleFormat: resolvedBundleFormat,
      bundleChecksum,
      encoding: fileEncoding,
      encodingFallback: typeof fileEncodingFallback === 'boolean' ? fileEncodingFallback : null,
      encodingConfidence: Number.isFinite(fileEncodingConfidence) ? fileEncodingConfidence : null
    };
  } catch {
    return null;
  }
}

/**
 * Remove incremental entries for deleted files and persist manifest.
 * @param {{enabled:boolean,manifest:object,manifestPath:string,bundleDir:string,seenFiles:Set<string>}} input
 */
export async function pruneIncrementalManifest({ enabled, manifest, manifestPath, bundleDir, seenFiles }) {
  if (!enabled) return;
  const seenNormalized = new Set(
    Array.from(seenFiles || [])
      .map((entry) => normalizeIncrementalRelPath(entry))
      .filter(Boolean)
  );
  for (const relKey of Object.keys(manifest.files)) {
    const normalizedRelKey = normalizeIncrementalRelPath(relKey);
    if (seenNormalized.has(normalizedRelKey)) continue;
    const entry = manifest.files[relKey];
    if (entry?.bundle) {
      const bundlePath = path.join(bundleDir, entry.bundle);
      try {
        await fs.rm(bundlePath, { force: true });
      } catch {}
    }
    delete manifest.files[relKey];
  }
  try {
    await atomicWriteJson(manifestPath, manifest, { spaces: 2 });
  } catch {}
}

/**
 * Prefetch existing bundle VFS manifest rows so cross-file bundle rewrites can
 * preserve them without paying a serialized read phase after inference.
 *
 * @param {{
 *   enabled:boolean,
 *   manifest:object,
 *   bundleDir:string,
 *   bundleFormat?:string|null,
 *   concurrency?:number
 * }} input
 * @returns {Promise<Map<string,Array<object>|null>|null>}
 */
export async function preloadIncrementalBundleVfsRows({
  enabled,
  manifest,
  bundleDir,
  bundleFormat = null,
  concurrency = 8
}) {
  if (!enabled) return null;
  const entries = Object.entries(manifest?.files || {});
  if (!entries.length) return new Map();
  const resolvedBundleFormat = normalizeBundleFormat(bundleFormat || manifest?.bundleFormat);
  const rowsByFile = new Map();
  const normalizedConcurrency = Number.isFinite(Number(concurrency)) && Number(concurrency) > 0
    ? Math.max(1, Math.floor(Number(concurrency)))
    : 8;
  const workerCount = Math.min(entries.length, normalizedConcurrency);
  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= entries.length) break;
      const [file, entry] = entries[index];
      const normalizedFile = normalizeIncrementalRelPath(file);
      const bundleName = entry?.bundle || resolveBundleFilename(file, resolvedBundleFormat);
      if (!bundleName) {
        rowsByFile.set(normalizedFile, null);
        continue;
      }
      const bundlePath = path.join(bundleDir, bundleName);
      if (!(await pathExists(bundlePath))) {
        rowsByFile.set(normalizedFile, null);
        continue;
      }
      let vfsManifestRows = null;
      try {
        const existing = await readBundleFile(bundlePath, {
          format: resolveBundleFormatFromName(bundleName, resolvedBundleFormat)
        });
        vfsManifestRows = Array.isArray(existing?.bundle?.vfsManifestRows)
          ? existing.bundle.vfsManifestRows
          : null;
      } catch {}
      rowsByFile.set(normalizedFile, vfsManifestRows);
    }
  });
  await Promise.all(workers);
  return rowsByFile;
}

/**
 * Update incremental bundles after cross-file inference.
 * @param {{
 *   enabled:boolean,
 *   manifest:object,
 *   bundleDir:string,
 *   chunks:object[],
 *   fileRelations:Map<string,object>|object|null,
 *   bundleFormat?:string|null,
 *   existingVfsManifestRowsByFile?:Map<string,Array<object>|null>|object|null,
 *   log:(msg:string)=>void
 * }} input
 */
export async function updateBundlesWithChunks({
  enabled,
  manifest,
  bundleDir,
  chunks,
  fileRelations,
  bundleFormat = null,
  existingVfsManifestRowsByFile = null,
  log
}) {
  if (!enabled) return;
  const startedAt = Date.now();
  const chunkMap = new Map();
  for (const chunk of chunks) {
    if (!chunk?.file) continue;
    const fileKey = normalizeIncrementalRelPath(chunk.file);
    const list = chunkMap.get(fileKey) || [];
    list.push(chunk);
    chunkMap.set(fileKey, list);
  }
  const resolvedBundleFormat = normalizeBundleFormat(bundleFormat || manifest?.bundleFormat);
  const pendingUpdates = [];
  for (const [file, entry] of Object.entries(manifest.files || {})) {
    const normalizedFile = normalizeIncrementalRelPath(file);
    const bundleName = entry?.bundle || resolveBundleFilename(file, resolvedBundleFormat);
    const fileChunks = chunkMap.get(normalizedFile);
    if (!bundleName || !fileChunks) continue;
    pendingUpdates.push({
      file,
      normalizedFile,
      entry,
      bundleName,
      bundleFormat: resolveBundleFormatFromName(bundleName, resolvedBundleFormat),
      fileChunks
    });
  }
  if (!pendingUpdates.length) return;
  const prioritizedPendingUpdates = prioritizePendingCrossFileBundleUpdates(pendingUpdates, { nowMs: startedAt });
  const hasPrefetchedRowsStore = !!(
    existingVfsManifestRowsByFile
    && (
      typeof existingVfsManifestRowsByFile.get === 'function'
      || typeof existingVfsManifestRowsByFile === 'object'
    )
  );
  let prefetchHits = 0;
  if (hasPrefetchedRowsStore) {
    for (const pending of prioritizedPendingUpdates) {
      if (resolvePrefetchedVfsRows(
        existingVfsManifestRowsByFile,
        pending.normalizedFile,
        pending.file
      ).hit) {
        prefetchHits += 1;
      }
    }
  }
  const prefetchCoverage = prioritizedPendingUpdates.length
    ? (prefetchHits / prioritizedPendingUpdates.length)
    : 0;
  const skipFallbackReadForPrefetchMisses = hasPrefetchedRowsStore && prefetchCoverage >= 0.95;
  if (
    hasPrefetchedRowsStore
    && !skipFallbackReadForPrefetchMisses
    && typeof log === 'function'
  ) {
    log(
      `[incremental] bundle VFS prefetch coverage ${(prefetchCoverage * 100).toFixed(1)}%; ` +
      'reading misses from existing bundles.'
    );
  }
  let bundleUpdates = 0;
  let bundlePatched = 0;
  let bundleSkipped = 0;
  let bundleFailures = 0;
  let nextProgressUpdate = 500;
  const updateTotal = prioritizedPendingUpdates.length;
  const cpuIdleRatio = await sampleCpuIdleRatio();
  const workerCount = resolveIncrementalBundleUpdateConcurrency({
    totalUpdates: updateTotal,
    cpuIdleRatio
  });
  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= prioritizedPendingUpdates.length) break;
      const {
        file,
        normalizedFile,
        entry,
        bundleName,
        bundleFormat,
        fileChunks
      } = prioritizedPendingUpdates[index];
      let relations = null;
      if (fileRelations) {
        relations = typeof fileRelations.get === 'function'
          ? (fileRelations.get(normalizedFile) || fileRelations.get(file) || null)
          : (fileRelations[normalizedFile] || fileRelations[file] || null);
      }
      const bundlePath = path.join(bundleDir, bundleName);
      let vfsManifestRows = null;
      let existingBundle = null;
      const prefetched = resolvePrefetchedVfsRows(
        existingVfsManifestRowsByFile,
        normalizedFile,
        file
      );
      if (prefetched.hit) {
        vfsManifestRows = prefetched.rows;
      }
      if (!prefetched.hit || !skipFallbackReadForPrefetchMisses || bundleFormat === 'json') {
        try {
          const existing = await readBundleFile(bundlePath, {
            format: bundleFormat
          });
          existingBundle = existing?.bundle || null;
          if (!prefetched.hit) {
            vfsManifestRows = Array.isArray(existing?.bundle?.vfsManifestRows)
              ? existing.bundle.vfsManifestRows
              : null;
          }
        } catch {}
      }
      const bundle = {
        file,
        hash: entry.hash,
        mtimeMs: entry.mtimeMs,
        size: entry.size,
        chunks: fileChunks,
        fileRelations: relations,
        vfsManifestRows,
        encoding: entry.encoding || null,
        encodingFallback: typeof entry.encodingFallback === 'boolean' ? entry.encodingFallback : null,
        encodingConfidence: Number.isFinite(entry.encodingConfidence) ? entry.encodingConfidence : null
      };
      if (shouldReuseExistingBundle(existingBundle, bundle)) {
        bundleSkipped += 1;
        continue;
      }
      if (existingBundle && bundleFormat === 'json') {
        try {
          const patchResult = await writeBundlePatch({
            bundlePath,
            previousBundle: existingBundle,
            nextBundle: bundle,
            format: bundleFormat
          });
          if (patchResult?.applied) {
            bundleUpdates += 1;
            bundlePatched += 1;
            continue;
          }
          if (patchResult?.reason === 'no-changes') {
            bundleSkipped += 1;
            continue;
          }
        } catch {}
      }
      try {
        await writeBundleFile({
          bundlePath,
          bundle,
          format: bundleFormat
        });
        bundleUpdates += 1;
      } catch {
        bundleFailures += 1;
      }
      const completed = bundleUpdates + bundleFailures;
      if (typeof log === 'function' && completed >= nextProgressUpdate && completed < updateTotal) {
        log(`[incremental] cross-file bundle updates: ${completed}/${updateTotal}`);
        nextProgressUpdate += 500;
      }
    }
  });
  await Promise.all(workers);
  if (bundleUpdates || bundleSkipped || bundleFailures) {
    const durationMs = Math.max(0, Date.now() - startedAt);
    const failureText = bundleFailures > 0 ? `, failed ${bundleFailures}` : '';
    const patchedText = bundlePatched > 0 ? `, patched ${bundlePatched}` : '';
    const skippedText = bundleSkipped > 0 ? `, reused ${bundleSkipped}` : '';
    log(
      `Cross-file inference updated ${bundleUpdates} incremental bundle(s)${patchedText}${skippedText}${failureText} `
      + `in ${durationMs}ms (workers=${workerCount}).`
    );
  }
}
