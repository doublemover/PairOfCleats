import path from 'node:path';
import { readTextFileSync } from '../../shared/encoding.js';
import { isAbsolutePathNative, isRelativePathEscape } from '../../shared/files.js';
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
    const cacheKey = buildLocalCacheKey({
      namespace: 'summary',
      payload: {
        absPath: canonicalAbsPath,
        start: chunk.start,
        end: chunk.end,
        maxWords
      }
    }).key;
    const summaryCache = getSummaryCache();
    const fileTextCache = getFileTextCache();
    const cached = summaryCache.get(cacheKey);
    if (cached !== null) return cached;
    let text = fileTextCache.get(canonicalAbsPath);
    if (text == null) {
      ({ text } = readTextFileSync(canonicalAbsPath));
      fileTextCache.set(canonicalAbsPath, text);
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
