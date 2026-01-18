import path from 'node:path';
import { smartChunk } from '../chunking.js';
import { buildLanguageContext } from '../language-registry.js';
import { resolveSpecialCodeExt } from '../constants.js';
import { readTextFile } from '../../shared/encoding.js';
import { fileExt, toPosix } from '../../shared/files.js';

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
  const sampleChunkLens = [];
  const ordered = Array.isArray(files) ? [...files].sort() : [];
  for (let i = 0; i < Math.min(20, ordered.length); ++i) {
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
        options: languageOptions
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
