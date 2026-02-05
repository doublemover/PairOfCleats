import path from 'node:path';
import { readTextFileSync } from '../../shared/encoding.js';
import { isAbsolutePathNative } from '../../shared/files.js';
import { getFileTextCache, getSummaryCache } from './cache.js';
import { buildLocalCacheKey } from '../../shared/cache-key.js';

export function getBodySummary(rootDir, chunk, maxWords = 80) {
  try {
    const root = path.resolve(rootDir);
    const absPath = path.resolve(rootDir, chunk.file);
    const relative = path.relative(root, absPath);
    if (relative.startsWith('..') || isAbsolutePathNative(relative)) {
      return '(Could not load summary)';
    }
    const cacheKey = buildLocalCacheKey({
      namespace: 'summary',
      payload: {
        absPath,
        start: chunk.start,
        end: chunk.end,
        maxWords
      }
    }).key;
    const summaryCache = getSummaryCache();
    const fileTextCache = getFileTextCache();
    const cached = summaryCache.get(cacheKey);
    if (cached !== null) return cached;
    let text = fileTextCache.get(absPath);
    if (text == null) {
      ({ text } = readTextFileSync(absPath));
      fileTextCache.set(absPath, text);
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
