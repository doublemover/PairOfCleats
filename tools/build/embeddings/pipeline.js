/**
 * Create per-file embeddings processor for code/doc payloads.
 * When `parallelDispatch=true`, code/doc embedding batches execute concurrently
 * only if both payload groups are present; otherwise processing stays serial to
 * avoid unnecessary scheduling overhead.
 *
 * @param {object} input
 * @param {boolean} [input.parallelDispatch=false]
 * @returns {(entry:object)=>Promise<void>}
 */
export const createFileEmbeddingsProcessor = ({
  embeddingBatchSize,
  getChunkEmbeddings,
  runBatched,
  assertVectorArrays,
  scheduleCompute,
  processFileEmbeddings,
  mode,
  parallelDispatch = false,
  mergeCodeDocBatches = true,
  onEmbeddingBatch = null,
  embeddingTextCache = null,
  onEmbeddingUsage = null
}) => {
  const batchObserver = typeof onEmbeddingBatch === 'function' ? onEmbeddingBatch : null;
  const usageObserver = typeof onEmbeddingUsage === 'function' ? onEmbeddingUsage : null;
  const canUseTextCache = embeddingTextCache
    && typeof embeddingTextCache.get === 'function'
    && typeof embeddingTextCache.set === 'function';
  const canCacheText = typeof embeddingTextCache?.canCache === 'function'
    ? embeddingTextCache.canCache
    : ((text) => typeof text === 'string');

  const isVectorLike = (value) => (
    Array.isArray(value)
    || (ArrayBuffer.isView(value) && !(value instanceof DataView))
  );

  /**
   * Deduplicate repeated payloads before embedding and optionally reuse
   * vectors from the in-memory text cache.
   *
   * This keeps dispatch deterministic while reducing model calls for repeated
   * boilerplate/comments that occur across many chunks/files.
   *
   * @param {string[]} texts
   * @param {string} label
   * @returns {Promise<Array<ArrayLike<number>>>}
   */
  const runEmbeddingsBatch = async (texts, label) => {
    if (!texts.length) return [];
    const vectors = new Array(texts.length).fill(null);
    const uniqueTexts = [];
    const uniqueIndices = [];
    const uniqueByText = new Map();
    let cacheHits = 0;
    let cacheMisses = 0;
    let batchDedupHits = 0;

    for (let i = 0; i < texts.length; i += 1) {
      const text = texts[i];
      const cacheable = canUseTextCache && canCacheText(text);
      if (cacheable) {
        const cached = embeddingTextCache.get(text);
        if (isVectorLike(cached) && cached.length > 0) {
          vectors[i] = cached;
          cacheHits += 1;
          continue;
        }
        cacheMisses += 1;
      }

      if (typeof text === 'string') {
        const priorSlot = uniqueByText.get(text);
        if (priorSlot != null) {
          uniqueIndices[priorSlot].push(i);
          batchDedupHits += 1;
          continue;
        }
        uniqueByText.set(text, uniqueTexts.length);
      }
      uniqueTexts.push(text);
      uniqueIndices.push([i]);
    }

    if (uniqueTexts.length > 0) {
      const computed = await runBatched({
        texts: uniqueTexts,
        batchSize: embeddingBatchSize,
        embed: (batch) => scheduleCompute(() => getChunkEmbeddings(batch)),
        onBatch: batchObserver
          ? (batchInfo) => {
            batchObserver({
              ...batchInfo,
              label
            });
          }
          : null
      });
      assertVectorArrays(computed, uniqueTexts.length, label);
      for (let i = 0; i < uniqueTexts.length; i += 1) {
        const vector = computed[i] || null;
        const indices = uniqueIndices[i] || [];
        for (const targetIndex of indices) {
          vectors[targetIndex] = vector;
        }
        if (canUseTextCache && canCacheText(uniqueTexts[i]) && isVectorLike(vector) && vector.length > 0) {
          embeddingTextCache.set(uniqueTexts[i], vector);
        }
      }
    }

    assertVectorArrays(vectors, texts.length, label);
    usageObserver?.({
      label,
      requested: texts.length,
      embedded: uniqueTexts.length,
      cacheHits,
      cacheMisses,
      batchDedupHits,
      cacheSize: canUseTextCache && typeof embeddingTextCache.size === 'function'
        ? embeddingTextCache.size()
        : null
    });
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
    if (mergeCodeDocBatches && entry.codeTexts.length && docPayloads.length) {
      const mergedPayloads = [...entry.codeTexts, ...docPayloads];
      const mergedEmbeds = await runEmbeddingsBatch(mergedPayloads, `${mode} code+doc`);
      const codeCount = entry.codeTexts.length;
      for (let i = 0; i < entry.codeMapping.length; i += 1) {
        entry.codeEmbeds[entry.codeMapping[i]] = mergedEmbeds[i] || null;
      }
      for (let i = 0; i < docMapping.length; i += 1) {
        entry.docVectorsRaw[docMapping[i]] = mergedEmbeds[codeCount + i] || null;
      }
    } else if (parallelDispatch && entry.codeTexts.length && docPayloads.length) {
      await Promise.all([runCode(), runDoc()]);
    } else {
      await runCode();
      await runDoc();
    }

    await processFileEmbeddings(entry);
  };
};
