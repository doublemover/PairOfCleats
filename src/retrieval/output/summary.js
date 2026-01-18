import path from 'node:path';
import { readTextFileSync } from '../../shared/encoding.js';
import { getFileTextCache, getSummaryCache } from './cache.js';

export function getBodySummary(rootDir, chunk, maxWords = 80) {
  try {
    const absPath = path.join(rootDir, chunk.file);
    const cacheKey = `${absPath}:${chunk.start}:${chunk.end}:${maxWords}`;
    const summaryCache = getSummaryCache();
    const fileTextCache = getFileTextCache();
    const cached = summaryCache.get(cacheKey);
    if (cached !== null) return cached;
    let text = fileTextCache.get(absPath);
    if (text == null) {
      ({ text } = readTextFileSync(absPath));
      fileTextCache.set(absPath, text);
    }
    const chunkText = text.slice(chunk.start, chunk.end)
      .replace(/\s+/g, ' ')
      .trim();
    const words = chunkText.split(/\s+/).slice(0, maxWords).join(' ');
    summaryCache.set(cacheKey, words);
    return words;
  } catch {
    return '(Could not load summary)';
  }
}
