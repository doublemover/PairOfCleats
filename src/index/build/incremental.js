import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { sha1 } from '../../shared/hash.js';
import { SIGNATURE_VERSION } from './indexer/signatures.js';
import {
  normalizeBundleFormat,
  readBundleFile,
  resolveBundleFilename,
  resolveBundleFormatFromName,
  writeBundleFile
} from '../../shared/bundle-io.js';

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
  if (enabled && fsSync.existsSync(manifestPath)) {
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
  return { enabled, incrementalDir, bundleDir, manifestPath, manifest, bundleFormat: manifest.bundleFormat };
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
  if (!fsSync.existsSync(indexStatePath) || !fsSync.existsSync(piecesPath)) {
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
  bundleFormat = null
}) {
  let cachedBundle = null;
  let fileHash = null;
  let buffer = null;
  if (!enabled) return { cachedBundle, fileHash, buffer };

  const resolvedBundleFormat = normalizeBundleFormat(bundleFormat || manifest?.bundleFormat);
  const cachedEntry = manifest.files[relKey];
  const bundleName = cachedEntry?.bundle || resolveBundleFilename(relKey, resolvedBundleFormat);
  const bundlePath = path.join(bundleDir, bundleName);
  if (cachedEntry && cachedEntry.size === fileStat.size && cachedEntry.mtimeMs === fileStat.mtimeMs && fsSync.existsSync(bundlePath)) {
    try {
      const result = await readBundleFile(bundlePath, {
        format: resolveBundleFormatFromName(bundleName, resolvedBundleFormat)
      });
      cachedBundle = result.ok ? result.bundle : null;
    } catch {
      cachedBundle = null;
    }
  } else if (cachedEntry && cachedEntry.hash && fsSync.existsSync(bundlePath)) {
    try {
      buffer = await fs.readFile(absPath);
      fileHash = sha1(buffer);
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
  bundleFormat = null
}) {
  if (!enabled) return null;
  const resolvedBundleFormat = normalizeBundleFormat(bundleFormat || manifest?.bundleFormat);
  const cachedEntry = manifest.files?.[relKey];
  if (!cachedEntry || cachedEntry.size !== fileStat.size || cachedEntry.mtimeMs !== fileStat.mtimeMs) {
    if (!cachedEntry || !cachedEntry.hash) return null;
    const bundleName = cachedEntry.bundle || resolveBundleFilename(relKey, resolvedBundleFormat);
    const bundlePath = path.join(bundleDir, bundleName);
    if (!fsSync.existsSync(bundlePath)) return null;
    try {
      const buffer = await fs.readFile(absPath);
      const fileHash = sha1(buffer);
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
  const bundleName = cachedEntry.bundle || resolveBundleFilename(relKey, resolvedBundleFormat);
  const bundlePath = path.join(bundleDir, bundleName);
  if (!fsSync.existsSync(bundlePath)) return null;
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
  bundleFormat = null
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
    fileRelations
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
      bundleChecksum
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
  for (const relKey of Object.keys(manifest.files)) {
    if (seenFiles.has(relKey)) continue;
    const entry = manifest.files[relKey];
    if (entry?.bundle) {
      const bundlePath = path.join(bundleDir, entry.bundle);
      if (fsSync.existsSync(bundlePath)) {
        try {
          await fs.rm(bundlePath);
        } catch {}
      }
    }
    delete manifest.files[relKey];
  }
  try {
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  } catch {}
}

/**
 * Update incremental bundles after cross-file inference.
 * @param {{enabled:boolean,manifest:object,bundleDir:string,chunks:object[],fileRelations:Map<string,object>|object|null,log:(msg:string)=>void}} input
 */
export async function updateBundlesWithChunks({
  enabled,
  manifest,
  bundleDir,
  chunks,
  fileRelations,
  bundleFormat = null,
  log
}) {
  if (!enabled) return;
  const chunkMap = new Map();
  for (const chunk of chunks) {
    if (!chunk?.file) continue;
    const list = chunkMap.get(chunk.file) || [];
    list.push(chunk);
    chunkMap.set(chunk.file, list);
  }
  let bundleUpdates = 0;
  const resolvedBundleFormat = normalizeBundleFormat(bundleFormat || manifest?.bundleFormat);
  for (const [file, entry] of Object.entries(manifest.files || {})) {
    const bundleName = entry?.bundle || resolveBundleFilename(file, resolvedBundleFormat);
    const fileChunks = chunkMap.get(file);
    if (!bundleName || !fileChunks) continue;
    let relations = null;
    if (fileRelations) {
      relations = typeof fileRelations.get === 'function'
        ? (fileRelations.get(file) || null)
        : (fileRelations[file] || null);
    }
    const bundlePath = path.join(bundleDir, bundleName);
    const bundle = {
      file,
      hash: entry.hash,
      mtimeMs: entry.mtimeMs,
      size: entry.size,
      chunks: fileChunks,
      fileRelations: relations
    };
    try {
      await writeBundleFile({
        bundlePath,
        bundle,
        format: resolveBundleFormatFromName(bundleName, resolvedBundleFormat)
      });
      bundleUpdates += 1;
    } catch {}
  }
  if (bundleUpdates) {
    log(`Cross-file inference updated ${bundleUpdates} incremental bundle(s).`);
  }
}
