import path from 'node:path';
import { smartChunk } from '../chunking.js';
import { buildLanguageContext } from '../language-registry.js';
import { resolveSpecialCodeExt } from '../constants.js';
import { readTextFile } from '../../shared/encoding.js';
import { fileExt, toPosix } from '../../shared/file-paths.js';

/** Keep the same lexicographically first 20 files without sorting/copying all paths. */
export const selectContextWindowSample = (files) => {
  const selected = [];
  if (!Array.isArray(files)) return selected;
  for (const file of files) {
    if (selected.length === 20 && file >= selected[19]) continue;
    let lower = 0;
    let upper = selected.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (selected[middle] <= file) lower = middle + 1;
      else upper = middle;
    }
    selected.splice(lower, 0, file);
    if (selected.length > 20) selected.pop();
  }
  return selected;
};

/**
 * Estimate context window size from sampled chunk lengths.
 *
 * This is heuristic and can vary based on the sampled files and active
 * chunking options. Treat the result as a best-effort default, not a guarantee.
 *
 * @param {{files:string[],root:string,mode:'code'|'prose',languageOptions:object}} input
 * @returns {Promise<number>}
 */
export async function estimateContextWindow({ files, root, mode, languageOptions }) {
  const sampleLanguageOptions = languageOptions && typeof languageOptions === 'object'
    ? {
      ...languageOptions,
      // Context-window estimation does not require tree-sitter accuracy and
      // should not trigger heavyweight grammar parser activation.
      treeSitter: { ...(languageOptions.treeSitter || {}), enabled: false }
    }
    : { treeSitter: { enabled: false } };
  const sampleChunkLens = [];
  const ordered = selectContextWindowSample(files);
  for (let i = 0; i < ordered.length; ++i) {
    try {
      const { text } = await readTextFile(ordered[i]);
      const relSample = path.relative(root, ordered[i]);
      const relSampleKey = toPosix(relSample);
      const baseName = path.basename(ordered[i]);
      const rawExt = fileExt(ordered[i]);
      const ext = resolveSpecialCodeExt(baseName) || rawExt;
      const { context: sampleContext } = await buildLanguageContext({
        ext,
        relPath: relSampleKey,
        mode,
        text,
        options: sampleLanguageOptions
      });
      const chunks0 = smartChunk({
        text,
        ext,
        relPath: relSampleKey,
        mode,
        context: {
          ...sampleContext,
          chunking: languageOptions?.chunking || null
        }
      });
      sampleChunkLens.push(...chunks0.map(c =>
        text.slice(c.start, c.end).split('\n').length
      ));
    } catch {
      continue;
    }
  }
  sampleChunkLens.sort((a, b) => a - b);
  const medianChunkLines = sampleChunkLens.length
    ? sampleChunkLens[Math.floor(sampleChunkLens.length / 2)]
    : 8;
  return Math.min(10, Math.max(3, Math.floor(medianChunkLines / 2)));
}
