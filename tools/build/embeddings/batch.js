export const flushEmbeddingsBatch = async ({
  pending,
  embeddingBatchSize,
  getChunkEmbeddings,
  runBatched,
  assertVectorArrays,
  processFileEmbeddings,
  mode
} = {}) => {
  if (!pending?.length) return;

  const combinedCodeTexts = [];
  const codeMappings = [];
  for (let i = 0; i < pending.length; i += 1) {
    const entry = pending[i];
    entry.codeEmbeds = new Array(entry.items.length).fill(null);
    entry.docVectorsRaw = new Array(entry.items.length).fill(null);
    for (let j = 0; j < entry.codeTexts.length; j += 1) {
      combinedCodeTexts.push(entry.codeTexts[j]);
      codeMappings.push({ entryIndex: i, chunkOffset: entry.codeMapping[j] });
    }
  }

  const codeEmbeds = combinedCodeTexts.length
    ? await runBatched({
      texts: combinedCodeTexts,
      batchSize: embeddingBatchSize,
      embed: getChunkEmbeddings
    })
    : [];
  if (combinedCodeTexts.length) {
    assertVectorArrays(codeEmbeds, combinedCodeTexts.length, `${mode} code`);
    for (let i = 0; i < codeMappings.length; i += 1) {
      const mapping = codeMappings[i];
      pending[mapping.entryIndex].codeEmbeds[mapping.chunkOffset] = codeEmbeds[i] || null;
    }
  }

  const docPayloads = [];
  const docMappings = [];
  for (let i = 0; i < pending.length; i += 1) {
    const entry = pending[i];
    for (let j = 0; j < entry.docTexts.length; j += 1) {
      if (entry.docTexts[j]) {
        docMappings.push({ entryIndex: i, chunkOffset: entry.docMapping[j] });
        docPayloads.push(entry.docTexts[j]);
      }
    }
  }
  if (docPayloads.length) {
    const docEmbeds = await runBatched({
      texts: docPayloads,
      batchSize: embeddingBatchSize,
      embed: getChunkEmbeddings
    });
    assertVectorArrays(docEmbeds, docPayloads.length, `${mode} doc`);
    for (let i = 0; i < docMappings.length; i += 1) {
      const mapping = docMappings[i];
      pending[mapping.entryIndex].docVectorsRaw[mapping.chunkOffset] = docEmbeds[i] || null;
    }
  }

  for (let i = 0; i < pending.length; i += 1) {
    await processFileEmbeddings(pending[i]);
  }

  pending.length = 0;
};
