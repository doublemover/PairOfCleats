import path from 'node:path';
import { smartChunk } from '../chunking.js';
import { buildLanguageContext } from '../language-registry.js';
import { resolveSpecialCodeExt } from '../constants.js';
import { readTextFile } from '../../shared/encoding.js';
import { fileExt, toPosix } from '../../shared/files.js';

/**
 * Estimate context window size from sampled chunk lengths.
 * @param {{files:string[],root:string,mode:'code'|'prose',languageOptions:object}} input
 * @returns {Promise<number>}
 */
export async function estimateContextWindow({ files, root, mode, languageOptions }) {
  const sampleChunkLens = [];
  // Ensure determinism regardless of upstream file enumeration order. We select a
  // stable lexicographic sample rather than relying on the first N entries.
  const sampleLimit = Math.min(20, files.length);
  const sampleFiles = [];
  const insertSorted = (arr, value) => {
    let i = arr.length;
    while (i > 0 && arr[i - 1] > value) i -= 1;
    arr.splice(i, 0, value);
  };
  for (const filePath of files) {
    if (sampleFiles.length < sampleLimit) {
      insertSorted(sampleFiles, filePath);
      continue;
    }
    const last = sampleFiles[sampleFiles.length - 1];
    if (filePath >= last) continue;
    insertSorted(sampleFiles, filePath);
    sampleFiles.pop();
  }

  for (let i = 0; i < sampleFiles.length; ++i) {
    try {
      const { text } = await readTextFile(sampleFiles[i]);
      const relSample = path.relative(root, sampleFiles[i]);
      const relSampleKey = toPosix(relSample);
      const baseName = path.basename(sampleFiles[i]);
      const rawExt = fileExt(sampleFiles[i]);
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
