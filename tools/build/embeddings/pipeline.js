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
  embeddingBatchTokenBudget = 0,
  estimateEmbeddingTokens = null,
  estimateEmbeddingTokensBatch = null,
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
  embeddingInFlightCoalescer = null,
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
  const canCoalesceInFlight = embeddingInFlightCoalescer
    && typeof embeddingInFlightCoalescer.claim === 'function';
  const estimateTokensBatch = typeof estimateEmbeddingTokensBatch === 'function'
    ? estimateEmbeddingTokensBatch
    : null;

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
    let inFlightJoined = 0;
    let inFlightOwned = 0;

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
      const pendingClaims = [];
      const computeTexts = [];
      const computeSlots = [];
      for (let i = 0; i < uniqueTexts.length; i += 1) {
        const text = uniqueTexts[i];
        const indices = uniqueIndices[i] || [];
        const slot = { text, indices, claim: null };
        const canJoin = canCoalesceInFlight && canUseTextCache && canCacheText(text) && typeof text === 'string';
        if (canJoin) {
          const claim = embeddingInFlightCoalescer.claim(text);
          if (claim && claim.owner === false && claim.promise) {
            pendingClaims.push({ indices, text, promise: claim.promise });
            inFlightJoined += indices.length;
            continue;
          }
          if (claim && claim.owner === true) {
            slot.claim = claim;
            inFlightOwned += indices.length;
          }
        }
        computeTexts.push(text);
        computeSlots.push(slot);
      }

      let tokenEstimates = null;
      if (estimateTokensBatch && computeTexts.length > 0) {
        try {
          const estimated = await estimateTokensBatch(computeTexts, label);
          if (Array.isArray(estimated) && estimated.length === computeTexts.length) {
            tokenEstimates = estimated.map((value) => Math.max(1, Math.floor(Number(value) || 1)));
          }
        } catch {
          tokenEstimates = null;
        }
      }

      let computed = [];
      try {
        if (computeTexts.length > 0) {
          computed = await runBatched({
            texts: computeTexts,
            batchSize: embeddingBatchSize,
            maxBatchTokens: embeddingBatchTokenBudget,
            estimateTokens: estimateEmbeddingTokens,
            tokenEstimates,
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
          assertVectorArrays(computed, computeTexts.length, label);
        }
      } catch (err) {
        for (const slot of computeSlots) {
          slot.claim?.reject?.(err);
        }
        throw err;
      }

      for (let i = 0; i < computeSlots.length; i += 1) {
        const slot = computeSlots[i];
        const vector = computed[i] || null;
        for (const targetIndex of slot.indices) {
          vectors[targetIndex] = vector;
        }
        if (canUseTextCache && canCacheText(slot.text) && isVectorLike(vector) && vector.length > 0) {
          embeddingTextCache.set(slot.text, vector);
        }
        slot.claim?.resolve?.(vector);
      }

      if (pendingClaims.length > 0) {
        await Promise.all(pendingClaims.map(async (claim) => {
          const vector = await claim.promise;
          for (const targetIndex of claim.indices) {
            vectors[targetIndex] = vector;
          }
          if (canUseTextCache && canCacheText(claim.text) && isVectorLike(vector) && vector.length > 0) {
            embeddingTextCache.set(claim.text, vector);
          }
        }));
      }

      usageObserver?.({
        label,
        requested: texts.length,
        embedded: computeTexts.length,
        cacheHits,
        cacheMisses,
        batchDedupHits,
        inFlightJoined,
        inFlightOwned,
        cacheSize: canUseTextCache && typeof embeddingTextCache.size === 'function'
          ? embeddingTextCache.size()
          : null
      });
      assertVectorArrays(vectors, texts.length, label);
      return vectors;
    }

    assertVectorArrays(vectors, texts.length, label);
    usageObserver?.({
      label,
      requested: texts.length,
      embedded: uniqueTexts.length,
      cacheHits,
      cacheMisses,
      batchDedupHits,
      inFlightJoined,
      inFlightOwned,
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
