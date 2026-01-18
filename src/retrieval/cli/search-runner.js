import { ERROR_CODES } from '../../shared/error-codes.js';

export async function runSearchByMode({
  searchPipeline,
  runProse,
  runExtractedProse,
  runCode,
  runRecords,
  idxProse,
  idxExtractedProse,
  idxCode,
  idxRecords,
  queryEmbeddingProse,
  queryEmbeddingExtractedProse,
  queryEmbeddingCode,
  queryEmbeddingRecords,
  signal
}) {
  const throwIfAborted = () => {
    if (!signal?.aborted) return;
    const error = new Error('Search cancelled.');
    error.code = ERROR_CODES.CANCELLED;
    error.cancelled = true;
    throw error;
  };
  throwIfAborted();
  const abortIfNeeded = () => {
    if (signal?.aborted) {
      const err = new Error('Search aborted.');
      err.code = 'ERR_ABORTED';
      throw err;
    }
  };
  abortIfNeeded();
  const prosePromise = runProse
    ? searchPipeline(idxProse, 'prose', queryEmbeddingProse)
    : Promise.resolve([]);
  const extractedProsePromise = runExtractedProse
    ? searchPipeline(idxExtractedProse, 'extracted-prose', queryEmbeddingExtractedProse)
    : Promise.resolve([]);
  const codePromise = runCode
    ? searchPipeline(idxCode, 'code', queryEmbeddingCode)
    : Promise.resolve([]);
  const recordsPromise = runRecords
    ? searchPipeline(idxRecords, 'records', queryEmbeddingRecords)
    : Promise.resolve([]);
  const [proseHits, extractedProseHits, codeHits, recordHits] = await Promise.all([
    prosePromise,
    extractedProsePromise,
    codePromise,
    recordsPromise
  ]);
  throwIfAborted();
  abortIfNeeded();
  return { proseHits, extractedProseHits, codeHits, recordHits };
}
