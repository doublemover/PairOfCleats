import { ERROR_CODES } from '../../shared/error-codes.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';

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
  let primaryFailure, failed = false, primaryIndex = -1;
  try {
    throwIfAborted();
    const modes = [
      [runProse, idxProse, 'prose', queryEmbeddingProse],
      [runExtractedProse, idxExtractedProse, 'extracted-prose', queryEmbeddingExtractedProse],
      [runCode, idxCode, 'code', queryEmbeddingCode],
      [runRecords, idxRecords, 'records', queryEmbeddingRecords]
    ];
    const settled = await Promise.allSettled(modes.map(([enabled, idx, mode, embedding], index) => (
      Promise.resolve().then(() => enabled ? searchPipeline(idx, mode, embedding) : [])
        .catch(error => { if (!failed) { failed = true; primaryFailure = error; primaryIndex = index; } throw error; })
    )));
    if (failed) {
      const siblingErrors = settled.filter((result, index) => result.status === 'rejected' && index !== primaryIndex)
        .map(result => result.reason);
      if (siblingErrors.length) throw addStorageFailureContext(primaryFailure,
        { siblingErrors: Object.freeze(siblingErrors) }, new AggregateError(siblingErrors, 'Sibling search modes failed.'),
        { secondaryPresent: true });
      throw primaryFailure;
    }
    const [proseHits, extractedProseHits, codeHits, recordHits] = settled.map(result => result.value);
    throwIfAborted();
    return { proseHits, extractedProseHits, codeHits, recordHits };
  } catch (error) {
    primaryFailure = error; failed = true; throw error;
  } finally {
    try { await searchPipeline.dispose?.(); }
    catch (cleanup) {
      if (failed) throw addStorageFailureContext(primaryFailure, {}, cleanup, { secondaryPresent: true });
      throw cleanup;
    }
  }
}
