import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { sha1 } from '../../shared/hash.js';

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
  log = null
}) {
  const incrementalDir = path.join(repoCacheRoot, 'incremental', mode);
  const bundleDir = path.join(incrementalDir, 'files');
  const manifestPath = path.join(incrementalDir, 'manifest.json');
  let manifest = {
    version: 3,
    mode,
    tokenizationKey: tokenizationKey || null,
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
        if (tokenizationKey && loadedKey !== tokenizationKey) {
          if (typeof log === 'function') {
            log(`[incremental] ${mode} cache reset: tokenization config changed.`);
          }
        } else {
          manifest = {
            version: loaded.version || 1,
            mode,
            tokenizationKey: loadedKey || tokenizationKey || null,
            files: loaded.files || {},
            shards: loaded.shards || null
          };
        }
      }
    } catch {}
  }
  if (enabled) {
    await fs.mkdir(bundleDir, { recursive: true });
  }
  return { enabled, incrementalDir, bundleDir, manifestPath, manifest };
}

/**
 * Attempt to load a cached bundle for a file.
 * @param {{enabled:boolean,absPath:string,relKey:string,fileStat:import('node:fs').Stats,manifest:object,bundleDir:string}} input
 * @returns {Promise<{cachedBundle:object|null,fileHash:string|null,text:string|null}>}
 */
export async function readCachedBundle({ enabled, absPath, relKey, fileStat, manifest, bundleDir }) {
  let cachedBundle = null;
  let text = null;
  let fileHash = null;
  if (!enabled) return { cachedBundle, fileHash, text };

  const cacheKey = sha1(relKey);
  const bundlePath = path.join(bundleDir, `${cacheKey}.json`);
  const cachedEntry = manifest.files[relKey];
  if (cachedEntry && cachedEntry.size === fileStat.size && cachedEntry.mtimeMs === fileStat.mtimeMs && fsSync.existsSync(bundlePath)) {
    try {
      cachedBundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
    } catch {
      cachedBundle = null;
    }
  } else if (cachedEntry && cachedEntry.hash && fsSync.existsSync(bundlePath)) {
    try {
      text = await fs.readFile(absPath, 'utf8');
      fileHash = sha1(text);
      if (fileHash === cachedEntry.hash) {
        cachedBundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
      }
    } catch {
      cachedBundle = null;
    }
  }

  return { cachedBundle, fileHash, text };
}

/**
 * Attempt to load cached imports for a file when size/mtime match.
 * @param {{enabled:boolean,absPath:string,relKey:string,fileStat:import('node:fs').Stats,manifest:object,bundleDir:string}} input
 * @returns {Promise<string[]|null>}
 */
export async function readCachedImports({ enabled, absPath, relKey, fileStat, manifest, bundleDir }) {
  if (!enabled) return null;
  const cachedEntry = manifest.files?.[relKey];
  if (!cachedEntry || cachedEntry.size !== fileStat.size || cachedEntry.mtimeMs !== fileStat.mtimeMs) {
    return null;
  }
  const bundleName = cachedEntry.bundle || `${sha1(relKey)}.json`;
  const bundlePath = path.join(bundleDir, bundleName);
  if (!fsSync.existsSync(bundlePath)) return null;
  try {
    const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
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
export async function writeIncrementalBundle({ enabled, bundleDir, relKey, fileStat, fileHash, fileChunks, fileRelations }) {
  if (!enabled) return null;
  const cacheKey = sha1(relKey);
  const bundlePath = path.join(bundleDir, `${cacheKey}.json`);
  const bundle = {
    file: relKey,
    hash: fileHash,
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    chunks: fileChunks,
    fileRelations
  };
  try {
    await fs.writeFile(bundlePath, JSON.stringify(bundle) + '\n');
    return {
      hash: fileHash,
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      bundle: path.basename(bundlePath)
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
export async function updateBundlesWithChunks({ enabled, manifest, bundleDir, chunks, fileRelations, log }) {
  if (!enabled) return;
  const chunkMap = new Map();
  for (const chunk of chunks) {
    if (!chunk?.file) continue;
    const list = chunkMap.get(chunk.file) || [];
    list.push(chunk);
    chunkMap.set(chunk.file, list);
  }
  let bundleUpdates = 0;
  for (const [file, entry] of Object.entries(manifest.files || {})) {
    const bundleName = entry?.bundle;
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
      await fs.writeFile(bundlePath, JSON.stringify(bundle) + '\n');
      bundleUpdates += 1;
    } catch {}
  }
  if (bundleUpdates) {
    log(`Cross-file inference updated ${bundleUpdates} incremental bundle(s).`);
  }
}
