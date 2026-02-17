export const createFileEmbeddingsProcessor = ({
  embeddingBatchSize,
  getChunkEmbeddings,
  runBatched,
  assertVectorArrays,
  scheduleCompute,
  processFileEmbeddings,
  mode,
  parallelDispatch = false
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

    const docPayloads = [];
    const docMapping = [];
    for (let i = 0; i < entry.docTexts.length; i += 1) {
      if (!entry.docTexts[i]) continue;
      docPayloads.push(entry.docTexts[i]);
      docMapping.push(entry.docMapping[i]);
    }
    const runCode = async () => {
      if (!entry.codeTexts.length) return;
      const codeEmbeds = await runEmbeddingsBatch(entry.codeTexts, `${mode} code`);
      for (let i = 0; i < entry.codeMapping.length; i += 1) {
        entry.codeEmbeds[entry.codeMapping[i]] = codeEmbeds[i] || null;
      }
    };
    const runDoc = async () => {
      if (!docPayloads.length) return;
      const docEmbeds = await runEmbeddingsBatch(docPayloads, `${mode} doc`);
      for (let i = 0; i < docMapping.length; i += 1) {
        entry.docVectorsRaw[docMapping[i]] = docEmbeds[i] || null;
      }
    };
    if (parallelDispatch && entry.codeTexts.length && docPayloads.length) {
      await Promise.all([runCode(), runDoc()]);
    } else {
      await runCode();
      await runDoc();
    }

    await processFileEmbeddings(entry);
  };
};
