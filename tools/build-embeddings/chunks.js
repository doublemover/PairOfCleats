import fsSync from 'node:fs';
import path from 'node:path';
import {
  normalizeBundleFormat,
  readBundleFile,
  resolveBundleFilename,
  resolveBundleFormatFromName
} from '../../src/shared/bundle-io.js';
import { sha1 } from '../../src/shared/hash.js';

export const buildChunkSignature = (items) => sha1(
  items.map(({ chunk }) => `${chunk.start}:${chunk.end}`).join('|')
);

export const buildChunksFromBundles = async (bundleDir, manifestFiles, bundleFormat) => {
  const resolvedBundleFormat = normalizeBundleFormat(bundleFormat);
  const chunksByFile = new Map();
  let maxChunkId = -1;
  let total = 0;
  for (const [relPath, entry] of Object.entries(manifestFiles || {})) {
    const bundleName = entry?.bundle || resolveBundleFilename(relPath, resolvedBundleFormat);
    const bundlePath = path.join(bundleDir, bundleName);
    if (!fsSync.existsSync(bundlePath)) continue;
    let bundle;
    try {
      const result = await readBundleFile(bundlePath, {
        format: resolveBundleFormatFromName(bundleName, resolvedBundleFormat)
      });
      if (!result.ok) continue;
      bundle = result.bundle;
    } catch {
      continue;
    }
    const filePath = bundle?.file || relPath;
    const chunks = Array.isArray(bundle?.chunks) ? bundle.chunks : [];
    if (!chunks.length) continue;
    const list = chunksByFile.get(filePath) || [];
    for (const chunk of chunks) {
      if (!chunk) continue;
      const id = Number.isFinite(chunk.id) ? chunk.id : null;
      if (Number.isFinite(id) && id > maxChunkId) maxChunkId = id;
      list.push({ index: Number.isFinite(id) ? id : null, chunk });
      total += 1;
    }
    chunksByFile.set(filePath, list);
  }
  if (!chunksByFile.size) {
    return { chunksByFile, totalChunks: 0 };
  }
  let totalChunks = maxChunkId >= 0 ? maxChunkId + 1 : total;
  if (maxChunkId < 0) {
    let next = 0;
    for (const list of chunksByFile.values()) {
      for (const item of list) {
        item.index = next;
        next += 1;
      }
    }
    totalChunks = next;
  } else {
    let next = maxChunkId + 1;
    for (const list of chunksByFile.values()) {
      for (const item of list) {
        if (Number.isFinite(item.index)) continue;
        item.index = next;
        next += 1;
      }
    }
    totalChunks = Math.max(totalChunks, next);
  }
  return { chunksByFile, totalChunks };
};
