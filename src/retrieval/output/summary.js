import path from 'node:path';
import fs from 'node:fs';
import { readTextFileSync } from '../../shared/encoding.js';
import { isAbsolutePathNative, isRelativePathEscape } from '../../shared/file-paths.js';
import { getFileTextCache, getSummaryCache } from './cache.js';
import { buildLocalCacheKey } from '../../shared/cache-key.js';
import { isWithinRoot, toRealPathSync } from '../../workspace/identity.js';

export function getBodySummary(rootDir, chunk, maxWords = 80) {
  try {
    const root = path.resolve(rootDir);
    const canonicalRoot = toRealPathSync(root);
    const absPath = path.resolve(rootDir, chunk.file);
    const canonicalAbsPath = toRealPathSync(absPath);
    const relative = path.relative(root, absPath);
    if (isRelativePathEscape(relative) || isAbsolutePathNative(relative)) {
      return '(Could not load summary)';
    }
    if (!isWithinRoot(canonicalAbsPath, canonicalRoot)) {
      return '(Could not load summary)';
    }
    const generation = () => {
      const stat = fs.statSync(canonicalAbsPath, { bigint: true });
      if (!stat.isFile()) throw new Error('Summary source is not a regular file.');
      return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
    };
    const fileGeneration = generation();
    const fileKey = buildLocalCacheKey({ namespace: 'summary-source', payload: { path: canonicalAbsPath, fileGeneration } }).key;
    const cacheKey = buildLocalCacheKey({
      namespace: 'summary',
      payload: {
        absPath: canonicalAbsPath,
        fileGeneration,
        start: chunk.start,
        end: chunk.end,
        maxWords
      }
    }).key;
    const summaryCache = getSummaryCache();
    const fileTextCache = getFileTextCache();
    const cached = summaryCache.get(cacheKey);
    if (cached !== null) return cached;
    let text = fileTextCache.get(fileKey);
    if (text == null) {
      ({ text } = readTextFileSync(canonicalAbsPath));
      if (generation() !== fileGeneration) throw new Error('Summary source changed while reading.');
      fileTextCache.set(fileKey, text);
    }
    const rawChunkText = text.slice(chunk.start, chunk.end);
    const cleanedLines = rawChunkText
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        if (trimmed === '/*' || trimmed === '/**' || trimmed === '*/') return '';
        if (trimmed.startsWith('/*')) return trimmed.replace(/^\/\*+\s?/, '');
        if (trimmed.startsWith('*/')) return '';
        if (trimmed.startsWith('*')) return trimmed.replace(/^\*\s?/, '');
        return line;
      })
      .filter(Boolean)
      .join(' ');
    const chunkText = cleanedLines.replace(/\s+/g, ' ').trim();
    const words = chunkText.split(/\s+/).slice(0, maxWords).join(' ');
    summaryCache.set(cacheKey, words);
    return words;
  } catch {
    return '(Could not load summary)';
  }
}
