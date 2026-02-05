export const createFileEmbeddingsProcessor = ({
  embeddingBatchSize,
  getChunkEmbeddings,
  runBatched,
  assertVectorArrays,
  scheduleCompute,
  processFileEmbeddings,
  mode
}) => {
  const runEmbeddingsBatch = async (texts, label) => {
    if (!texts.length) return [];
    const vectors = await runBatched({
      texts,
      batchSize: embeddingBatchSize,
      embed: (batch) => scheduleCompute(() => getChunkEmbeddings(batch))
    });
    assertVectorArrays(vectors, texts.length, label);
    return vectors;
  };

  return async (entry) => {
    entry.codeEmbeds = new Array(entry.items.length).fill(null);
    entry.docVectorsRaw = new Array(entry.items.length).fill(null);

    if (entry.codeTexts.length) {
      const codeEmbeds = await runEmbeddingsBatch(entry.codeTexts, `${mode} code`);
      for (let i = 0; i < entry.codeMapping.length; i += 1) {
        entry.codeEmbeds[entry.codeMapping[i]] = codeEmbeds[i] || null;
      }
    }

    const docPayloads = [];
    const docMapping = [];
    for (let i = 0; i < entry.docTexts.length; i += 1) {
      if (!entry.docTexts[i]) continue;
      docPayloads.push(entry.docTexts[i]);
      docMapping.push(entry.docMapping[i]);
    }
    if (docPayloads.length) {
      const docEmbeds = await runEmbeddingsBatch(docPayloads, `${mode} doc`);
      for (let i = 0; i < docMapping.length; i += 1) {
        entry.docVectorsRaw[docMapping[i]] = docEmbeds[i] || null;
      }
    }

    await processFileEmbeddings(entry);
  };
};
