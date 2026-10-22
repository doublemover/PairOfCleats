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
  let primaryFailure = null;
  const modes = [
    [runProse, idxProse, 'prose', queryEmbeddingProse],
    [runExtractedProse, idxExtractedProse, 'extracted-prose', queryEmbeddingExtractedProse],
    [runCode, idxCode, 'code', queryEmbeddingCode],
    [runRecords, idxRecords, 'records', queryEmbeddingRecords]
  ];
  const settled = await Promise.allSettled(modes.map(([enabled, idx, mode, embedding]) => (
    Promise.resolve().then(() => enabled ? searchPipeline(idx, mode, embedding) : [])
      .catch(error => { primaryFailure ||= error; throw error; })
  )));
  if (primaryFailure) {
    const siblingErrors = settled.filter(result => result.status === 'rejected' && result.reason !== primaryFailure)
      .map(result => result.reason);
    if (siblingErrors.length) primaryFailure.siblingErrors = siblingErrors;
    throw primaryFailure;
  }
  const [proseHits, extractedProseHits, codeHits, recordHits] = settled.map(result => result.value);
  throwIfAborted();
  return { proseHits, extractedProseHits, codeHits, recordHits };
}
