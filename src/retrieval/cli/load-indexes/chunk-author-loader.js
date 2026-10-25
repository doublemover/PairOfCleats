import {
  __testScmChunkAuthorHydration,
  hydrateChunkAuthorsForIndex
} from '../chunk-authors.js';

export { __testScmChunkAuthorHydration };

export async function hydrateChunkAuthorIndexes({
  idxCode,
  idxProse,
  idxExtractedProse,
  idxRecords,
  runCode,
  runProse,
  runRecords,
  resolvedLoadExtractedProse,
  rootDir,
  userConfig,
  fileChargramN,
  filtersActive,
  chunkAuthorFilterActive = false,
  emitOutput,
  signal = null
}) {
  const scmHydrationTargets = [
    runCode ? { idx: idxCode, mode: 'code' } : null,
    runProse ? { idx: idxProse, mode: 'prose' } : null,
    resolvedLoadExtractedProse ? { idx: idxExtractedProse, mode: 'extracted-prose' } : null,
    runRecords ? { idx: idxRecords, mode: 'records' } : null
  ].filter(Boolean);
  if (!scmHydrationTargets.length) return {};
  return Object.fromEntries(await Promise.all(
    scmHydrationTargets.map(async ({ idx, mode }) => [mode, (await hydrateChunkAuthorsForIndex({
      idx,
      mode,
      rootDir,
      userConfig,
      fileChargramN,
      filtersActive,
      chunkAuthorFilterActive,
      emitOutput, signal
    })).coverage || null])
  ));
}
