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
  queryEmbeddingRecords
}) {
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
  return { proseHits, extractedProseHits, codeHits, recordHits };
}
