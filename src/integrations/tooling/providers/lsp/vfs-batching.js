import path from 'node:path';
import { pathToFileUri } from '../../lsp/client.js';
import { resolveVfsTokenUri } from '../../lsp/uris.js';
import { ensureVfsDiskDocument, resolveVfsDiskPath } from '../../../../index/tooling/vfs.js';

/**
 * Ensure a VFS document exists on disk for file-based LSP servers.
 * Uses docHash to avoid unnecessary rewrites.
 */
const ensureVirtualFile = async (rootDir, doc, coldStartCache = null) => {
  const virtualPath = doc?.virtualPath;
  const normalized = typeof virtualPath === 'string' ? virtualPath.replace(/\\/g, '/') : '';
  if (!normalized) {
    throw new Error('LSP document is missing a virtualPath.');
  }
  if (path.isAbsolute(normalized) || normalized.startsWith('/')) {
    throw new Error(`LSP virtualPath must be relative: ${normalized}`);
  }
  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error(`LSP virtualPath must not escape the VFS root: ${normalized}`);
  }
  const result = await ensureVfsDiskDocument({
    baseDir: rootDir,
    virtualPath: doc.virtualPath,
    text: doc.text || '',
    docHash: doc.docHash || null,
    coldStartCache
  });
  return result.path;
};

/**
 * Normalize optional VFS IO batching configuration.
 * @param {object|null} value
 * @returns {{maxInflight:number,maxQueueEntries:number,maxBatchBytes:number,flushIntervalMs:number,writeMode:string}|null}
 */
export const resolveVfsIoBatching = (value) => {
  if (!value || typeof value !== 'object') return null;
  if (value.enabled !== true) return null;
  const maxInflightRaw = Number(value.maxInflight);
  const maxInflight = Number.isFinite(maxInflightRaw) ? Math.max(1, Math.floor(maxInflightRaw)) : 4;
  const maxQueueRaw = Number(value.maxQueueEntries);
  const maxQueueEntries = Number.isFinite(maxQueueRaw) ? Math.max(1, Math.floor(maxQueueRaw)) : 5000;
  const maxBatchBytesRaw = Number(value.maxBatchBytes);
  const maxBatchBytes = Number.isFinite(maxBatchBytesRaw) && maxBatchBytesRaw > 0
    ? Math.max(1, Math.floor(maxBatchBytesRaw))
    : Number.POSITIVE_INFINITY;
  const flushIntervalRaw = Number(value.flushIntervalMs);
  const flushIntervalMs = Number.isFinite(flushIntervalRaw) && flushIntervalRaw > 0
    ? Math.max(1, Math.floor(flushIntervalRaw))
    : 0;
  const writeModeRaw = String(value.writeMode || 'direct').trim().toLowerCase();
  const writeMode = writeModeRaw === 'atomic' ? 'atomic' : 'direct';
  return { maxInflight, maxQueueEntries, maxBatchBytes, flushIntervalMs, writeMode };
};

const byteLengthOfDoc = (doc) => Buffer.byteLength(String(doc?.text || ''), 'utf8');

const writeVfsEntryWithRetry = async ({ rootDir, entry, coldStartCache, warnings }) => {
  const write = () => ensureVfsDiskDocument({
    baseDir: rootDir,
    virtualPath: entry.doc.virtualPath,
    text: entry.doc.text || '',
    docHash: entry.doc.docHash || null,
    coldStartCache
  });
  try {
    return await write();
  } catch (error) {
    warnings.push({
      code: 'VFS_WRITE_RETRY',
      virtualPath: entry.doc.virtualPath,
      message: error?.message || String(error)
    });
    try {
      return await write();
    } catch (retryError) {
      warnings.push({
        code: 'VFS_WRITE_FAILED',
        virtualPath: entry.doc.virtualPath,
        message: retryError?.message || String(retryError)
      });
      if (retryError && typeof retryError === 'object') {
        retryError.warnings = warnings;
      }
      throw retryError;
    }
  }
};

/**
 * Create a queued VFS writer with last-write-wins coalescing.
 *
 * Pending entries are keyed by their final disk path so duplicated virtual
 * writes coalesce before hitting the filesystem. Flushes are bounded by
 * maxInflight and can be triggered by queue length, queued bytes, an optional
 * flush interval, or an explicit drain.
 *
 * @param {object} input
 * @param {string} input.rootDir
 * @param {{maxInflight?:number,maxQueueEntries?:number,maxBatchBytes?:number,flushIntervalMs?:number,writeMode?:string}|null} input.batching
 * @param {object|null} input.coldStartCache
 * @returns {{enqueue:(doc:object)=>Promise<void>,flush:()=>Promise<Map<string,string>>,drain:()=>Promise<Map<string,string>>,results:Map<string,string>,warnings:Array<object>,getPendingSize:()=>number}}
 */
export const createVfsQueuedWriteBatcher = ({ rootDir, batching, coldStartCache = null }) => {
  const resolvedBatching = (batching && typeof batching === 'object' && batching.enabled !== true)
    ? {
      maxInflight: Math.max(1, Math.floor(Number(batching.maxInflight) || 1)),
      maxQueueEntries: Math.max(1, Math.floor(Number(batching.maxQueueEntries) || 5000)),
      maxBatchBytes: Number.isFinite(Number(batching.maxBatchBytes)) && Number(batching.maxBatchBytes) > 0
        ? Math.max(1, Math.floor(Number(batching.maxBatchBytes)))
        : Number.POSITIVE_INFINITY,
      flushIntervalMs: Number.isFinite(Number(batching.flushIntervalMs)) && Number(batching.flushIntervalMs) > 0
        ? Math.max(1, Math.floor(Number(batching.flushIntervalMs)))
        : 0,
      writeMode: String(batching.writeMode || 'direct').trim().toLowerCase() === 'atomic' ? 'atomic' : 'direct'
    }
    : resolveVfsIoBatching(batching) || {
      maxInflight: 1,
      maxQueueEntries: 5000,
      maxBatchBytes: Number.POSITIVE_INFINITY,
      flushIntervalMs: 0,
      writeMode: 'direct'
    };
  const pending = new Map();
  const results = new Map();
  const warnings = [];
  let queuedBytes = 0;
  let sequence = 0;
  let timer = null;
  let flushChain = Promise.resolve();
  let asyncFlushError = null;

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const scheduleFlush = () => {
    if (!resolvedBatching.flushIntervalMs || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flush().catch((error) => {
        asyncFlushError = error;
      });
    }, resolvedBatching.flushIntervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  };

  const flushNow = async () => {
    clearTimer();
    const entries = Array.from(pending.values()).sort((left, right) => left.sequence - right.sequence);
    pending.clear();
    queuedBytes = 0;
    if (!entries.length) return results;

    let index = 0;
    const workerCount = Math.min(resolvedBatching.maxInflight, entries.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (index < entries.length) {
        const current = entries[index];
        index += 1;
        const result = await writeVfsEntryWithRetry({
          rootDir,
          entry: current,
          coldStartCache,
          warnings
        });
        results.set(current.doc.virtualPath, result.path);
      }
    });
    await Promise.all(workers);
    return results;
  };

  const flush = async () => {
    flushChain = flushChain.then(flushNow, flushNow);
    return await flushChain;
  };

  const enqueue = async (doc) => {
    if (asyncFlushError) throw asyncFlushError;
    const diskPath = resolveVfsDiskPath({ baseDir: rootDir, virtualPath: doc?.virtualPath });
    const sizeBytes = byteLengthOfDoc(doc);
    const existing = pending.get(diskPath);
    if (!existing && pending.size >= resolvedBatching.maxQueueEntries) {
      await flush();
    }
    if (
      !existing
      && pending.size > 0
      && queuedBytes + sizeBytes > resolvedBatching.maxBatchBytes
    ) {
      await flush();
    }

    const previous = pending.get(diskPath);
    if (previous) queuedBytes -= previous.sizeBytes;
    pending.set(diskPath, {
      diskPath,
      doc,
      sizeBytes,
      sequence: sequence += 1
    });
    queuedBytes += sizeBytes;
    if (queuedBytes >= resolvedBatching.maxBatchBytes) {
      await flush();
    } else {
      scheduleFlush();
    }
  };

  const drain = async () => {
    const drained = await flush();
    if (asyncFlushError) throw asyncFlushError;
    return drained;
  };

  return {
    enqueue,
    flush,
    drain,
    results,
    warnings,
    getPendingSize: () => pending.size
  };
};

/**
 * Ensure many virtual files exist on disk using bounded parallel writes.
 *
 * Work is chunked into queue windows so very large document sets do not create
 * unbounded in-memory pending promise lists.
 *
 * @param {object} input
 * @param {string} input.rootDir
 * @param {Array<{virtualPath:string,text?:string,docHash?:string}>} input.docs
 * @param {{maxInflight?:number,maxQueueEntries?:number,maxBatchBytes?:number,flushIntervalMs?:number,writeMode?:string}|null} input.batching
 * @param {object|null} input.coldStartCache
 * @returns {Promise<Map<string,string>>}
 */
export const ensureVirtualFilesBatch = async ({ rootDir, docs, batching, coldStartCache }) => {
  const results = new Map();
  if (!Array.isArray(docs) || docs.length === 0) return results;
  const writer = createVfsQueuedWriteBatcher({
    rootDir,
    batching: batching
      ? { enabled: true, ...batching }
      : { enabled: true, maxInflight: 1, maxQueueEntries: docs.length },
    coldStartCache
  });

  for (const doc of docs) {
    await writer.enqueue(doc);
  }

  return await writer.drain();
};

/**
 * Normalize URI scheme to supported provider values.
 * @param {string} value
 * @returns {'file'|'poc-vfs'}
 */
export const normalizeUriScheme = (value) => (value === 'poc-vfs' ? 'poc-vfs' : 'file');

/**
 * Resolve document URI for LSP operations.
 *
 * `poc-vfs` mode emits tokenized virtual URIs, while `file` mode ensures a
 * backing disk file exists and returns a `file://` URI.
 *
 * @param {object} input
 * @returns {Promise<string>}
 */
export const resolveDocumentUri = async ({
  rootDir,
  doc,
  uriScheme,
  tokenMode,
  diskPathMap,
  coldStartCache
}) => {
  if (uriScheme === 'poc-vfs') {
    const resolved = await resolveVfsTokenUri({
      virtualPath: doc.virtualPath,
      docHash: doc.docHash || null,
      mode: tokenMode
    });
    return resolved.uri;
  }

  const cachedPath = diskPathMap?.get(doc.virtualPath) || null;
  const absPath = cachedPath || await ensureVirtualFile(rootDir, doc, coldStartCache);
  return pathToFileUri(absPath);
};
