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
  emitOutput
}) {
  const scmHydrationTargets = [
    runCode ? { idx: idxCode, mode: 'code' } : null,
    runProse ? { idx: idxProse, mode: 'prose' } : null,
    resolvedLoadExtractedProse ? { idx: idxExtractedProse, mode: 'extracted-prose' } : null,
    runRecords ? { idx: idxRecords, mode: 'records' } : null
  ].filter(Boolean);
  if (!scmHydrationTargets.length) return;
  await Promise.all(
    scmHydrationTargets.map(({ idx, mode }) => hydrateChunkAuthorsForIndex({
      idx,
      mode,
      rootDir,
      userConfig,
      fileChargramN,
      filtersActive,
      chunkAuthorFilterActive,
      emitOutput
    }))
  );
}
