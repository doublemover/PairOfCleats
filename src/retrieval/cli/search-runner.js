export function runSearchByMode({
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
  const proseHits = runProse
    ? searchPipeline(idxProse, 'prose', queryEmbeddingProse)
    : [];
  const extractedProseHits = runExtractedProse
    ? searchPipeline(idxExtractedProse, 'extracted-prose', queryEmbeddingExtractedProse)
    : [];
  const codeHits = runCode
    ? searchPipeline(idxCode, 'code', queryEmbeddingCode)
    : [];
  const recordHits = runRecords
    ? searchPipeline(idxRecords, 'records', queryEmbeddingRecords)
    : [];
  return { proseHits, extractedProseHits, codeHits, recordHits };
}
