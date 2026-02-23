import path from 'node:path';
import { pathToFileUri } from '../../lsp/client.js';
import { resolveVfsTokenUri } from '../../lsp/uris.js';
import { ensureVfsDiskDocument } from '../../../../index/tooling/vfs.js';

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

export const resolveVfsIoBatching = (value) => {
  if (!value || typeof value !== 'object') return null;
  if (value.enabled !== true) return null;
  const maxInflightRaw = Number(value.maxInflight);
  const maxInflight = Number.isFinite(maxInflightRaw) ? Math.max(1, Math.floor(maxInflightRaw)) : 4;
  const maxQueueRaw = Number(value.maxQueueEntries);
  const maxQueueEntries = Number.isFinite(maxQueueRaw) ? Math.max(1, Math.floor(maxQueueRaw)) : 5000;
  return { maxInflight, maxQueueEntries };
};

export const ensureVirtualFilesBatch = async ({ rootDir, docs, batching, coldStartCache }) => {
  const results = new Map();
  if (!Array.isArray(docs) || docs.length === 0) return results;
  const maxInflight = batching?.maxInflight ? Math.max(1, batching.maxInflight) : 1;
  const maxQueueEntries = batching?.maxQueueEntries
    ? Math.max(1, batching.maxQueueEntries)
    : docs.length;

  for (let start = 0; start < docs.length; start += maxQueueEntries) {
    const slice = docs.slice(start, start + maxQueueEntries);
    let index = 0;
    const workers = Array.from({ length: maxInflight }, async () => {
      while (true) {
        const current = index;
        index += 1;
        if (current >= slice.length) break;
        const doc = slice[current];
        const result = await ensureVfsDiskDocument({
          baseDir: rootDir,
          virtualPath: doc.virtualPath,
          text: doc.text || '',
          docHash: doc.docHash || null,
          coldStartCache
        });
        results.set(doc.virtualPath, result.path);
      }
    });
    await Promise.all(workers);
  }

  return results;
};

export const normalizeUriScheme = (value) => (value === 'poc-vfs' ? 'poc-vfs' : 'file');

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
