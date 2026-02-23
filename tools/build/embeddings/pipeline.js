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
  globalMicroBatching = false,
  globalMicroBatchingFillTarget = 0.85,
  globalMicroBatchingMaxWaitMs = 8,
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
  const globalBatchingEnabled = globalMicroBatching === true;
  const globalBatchingFillTarget = Number.isFinite(Number(globalMicroBatchingFillTarget))
    ? Math.max(0.5, Math.min(0.99, Number(globalMicroBatchingFillTarget)))
    : 0.85;
  const globalBatchingMaxWait = Number.isFinite(Number(globalMicroBatchingMaxWaitMs))
    ? Math.max(0, Math.floor(Number(globalMicroBatchingMaxWaitMs)))
    : 8;
  const maxBatchItems = Number.isFinite(Number(embeddingBatchSize)) && Number(embeddingBatchSize) > 0
    ? Math.max(1, Math.floor(Number(embeddingBatchSize)))
    : Number.MAX_SAFE_INTEGER;

  const isVectorLike = (value) => (
    Array.isArray(value)
    || (ArrayBuffer.isView(value) && !(value instanceof DataView))
  );
  const resolveTokenEstimate = (text, estimated) => {
    const normalized = Math.floor(Number(estimated));
    if (Number.isFinite(normalized) && normalized > 0) return normalized;
    if (typeof estimateEmbeddingTokens === 'function') {
      const fallback = Math.floor(Number(estimateEmbeddingTokens(text)));
      if (Number.isFinite(fallback) && fallback > 0) return fallback;
    }
    const chars = typeof text === 'string' ? text.length : 0;
    return Math.max(1, Math.ceil(chars / 4));
  };
  const resolveGlobalTargetTokens = () => {
    if (embeddingBatchTokenBudget > 0) {
      return Math.max(1, Math.floor(embeddingBatchTokenBudget * globalBatchingFillTarget));
    }
    const targetItems = maxBatchItems === Number.MAX_SAFE_INTEGER
      ? 1
      : maxBatchItems;
    return Math.max(1, Math.floor(targetItems * globalBatchingFillTarget));
  };
  let globalPendingRequests = [];
  let globalPendingTextCount = 0;
  let globalPendingTokenCount = 0;
  let globalFlushTimer = null;
  let globalFlushInFlight = null;
  let globalForceFlushRequested = false;

  const clearGlobalFlushTimer = () => {
    if (!globalFlushTimer) return;
    clearTimeout(globalFlushTimer);
    globalFlushTimer = null;
  };

  const hasGlobalCapacityPressure = () => {
    if (globalPendingTextCount <= 0) return false;
    if (embeddingBatchTokenBudget > 0 && globalPendingTokenCount >= embeddingBatchTokenBudget) return true;
    return maxBatchItems !== Number.MAX_SAFE_INTEGER && globalPendingTextCount >= maxBatchItems;
  };

  const hasGlobalFillTarget = () => (
    globalPendingTextCount > 0 && globalPendingTokenCount >= resolveGlobalTargetTokens()
  );

  const scheduleGlobalFlushTimer = () => {
    if (!globalBatchingEnabled) return;
    if (globalFlushTimer || globalFlushInFlight || globalPendingRequests.length === 0) return;
    if (globalBatchingMaxWait === 0) {
      void flushGlobalRequests({ force: true });
      return;
    }
    let oldestEnqueuedAt = Number.POSITIVE_INFINITY;
    for (const request of globalPendingRequests) {
      if (request.enqueuedAt < oldestEnqueuedAt) oldestEnqueuedAt = request.enqueuedAt;
    }
    const ageMs = Number.isFinite(oldestEnqueuedAt)
      ? Math.max(0, Date.now() - oldestEnqueuedAt)
      : 0;
    const delayMs = Math.max(0, globalBatchingMaxWait - ageMs);
    globalFlushTimer = setTimeout(() => {
      globalFlushTimer = null;
      void flushGlobalRequests({ force: true });
    }, delayMs);
  };

  const flushGlobalRequests = async ({ force = false } = {}) => {
    if (!globalBatchingEnabled) return;
    if (force) globalForceFlushRequested = true;
    if (globalFlushInFlight) return globalFlushInFlight;
    globalFlushInFlight = (async () => {
      const flushAll = force || globalForceFlushRequested;
      globalForceFlushRequested = false;
      while (globalPendingRequests.length > 0) {
        const shouldFlushNow = flushAll || hasGlobalCapacityPressure() || hasGlobalFillTarget();
        if (!shouldFlushNow) break;
        clearGlobalFlushTimer();
        const snapshot = globalPendingRequests;
        globalPendingRequests = [];
        globalPendingTextCount = 0;
        globalPendingTokenCount = 0;

        const requestSizes = [];
        const requestLabels = new Set();
        const flattenedTexts = [];
        const flattenedTokenEstimates = [];
        let oldestEnqueuedAt = Number.POSITIVE_INFINITY;
        for (const request of snapshot) {
          const texts = Array.isArray(request.texts) ? request.texts : [];
          const estimates = Array.isArray(request.tokenEstimates) ? request.tokenEstimates : null;
          requestSizes.push(texts.length);
          requestLabels.add(request.label || `${mode} global`);
          if (request.enqueuedAt < oldestEnqueuedAt) oldestEnqueuedAt = request.enqueuedAt;
          for (let i = 0; i < texts.length; i += 1) {
            const text = texts[i];
            flattenedTexts.push(text);
            flattenedTokenEstimates.push(resolveTokenEstimate(text, estimates?.[i]));
          }
        }
        const queueWaitMs = Number.isFinite(oldestEnqueuedAt)
          ? Math.max(0, Date.now() - oldestEnqueuedAt)
          : 0;
        const mergedLabel = requestLabels.size === 1
          ? [...requestLabels][0]
          : `${mode} global(${requestLabels.size})`;
        const targetTokens = resolveGlobalTargetTokens();
        try {
          const computed = await runBatched({
            texts: flattenedTexts,
            batchSize: embeddingBatchSize,
            maxBatchTokens: embeddingBatchTokenBudget,
            estimateTokens: estimateEmbeddingTokens,
            tokenEstimates: flattenedTokenEstimates,
            embed: (batch) => scheduleCompute(() => getChunkEmbeddings(batch)),
            onBatch: batchObserver
              ? (batchInfo) => {
                const budget = Math.max(0, Math.floor(Number(batchInfo?.batchTokenBudget) || 0));
                const targetBatchTokens = budget > 0
                  ? Math.max(1, targetTokens)
                  : Math.max(1, Math.floor(Number(batchInfo?.targetBatchTokens) || 0));
                const batchTokens = Math.max(0, Math.floor(Number(batchInfo?.batchTokens) || 0));
                const underfilledTokens = Math.max(0, targetBatchTokens - batchTokens);
                const batchFillRatio = targetBatchTokens > 0
                  ? Math.max(0, Math.min(1, batchTokens / targetBatchTokens))
                  : 1;
                batchObserver({
                  ...batchInfo,
                  label: mergedLabel,
                  targetBatchTokens,
                  underfilledTokens,
                  batchFillRatio,
                  queueWaitMs,
                  mergedRequests: snapshot.length,
                  mergedLabels: requestLabels.size
                });
              }
              : null
          });
          assertVectorArrays(computed, flattenedTexts.length, mergedLabel);
          let offset = 0;
          for (let i = 0; i < snapshot.length; i += 1) {
            const request = snapshot[i];
            const count = requestSizes[i] || 0;
            request.resolve(computed.slice(offset, offset + count));
            offset += count;
          }
        } catch (err) {
          for (const request of snapshot) {
            request.reject(err);
          }
        }
      }
    })().finally(() => {
      globalFlushInFlight = null;
      if (globalPendingRequests.length > 0) {
        if (hasGlobalCapacityPressure() || hasGlobalFillTarget()) {
          void flushGlobalRequests();
        } else {
          scheduleGlobalFlushTimer();
        }
      }
    });
    return globalFlushInFlight;
  };

  const enqueueGlobalBatchRequest = ({ texts, label, tokenEstimates }) => new Promise((resolve, reject) => {
    if (!globalBatchingEnabled) {
      resolve([]);
      return;
    }
    const normalizedTexts = Array.isArray(texts) ? texts : [];
    const normalizedTokenEstimates = Array.isArray(tokenEstimates) && tokenEstimates.length === normalizedTexts.length
      ? tokenEstimates
      : null;
    let requestTokens = 0;
    for (let i = 0; i < normalizedTexts.length; i += 1) {
      requestTokens += resolveTokenEstimate(normalizedTexts[i], normalizedTokenEstimates?.[i]);
    }
    globalPendingRequests.push({
      texts: normalizedTexts,
      tokenEstimates: normalizedTokenEstimates,
      label,
      resolve,
      reject,
      enqueuedAt: Date.now()
    });
    globalPendingTextCount += normalizedTexts.length;
    globalPendingTokenCount += requestTokens;
    if (hasGlobalCapacityPressure() || hasGlobalFillTarget()) {
      void flushGlobalRequests();
    } else {
      scheduleGlobalFlushTimer();
    }
  });

  const drainGlobalBatching = async () => {
    if (!globalBatchingEnabled) return;
    clearGlobalFlushTimer();
    await flushGlobalRequests({ force: true });
    if (globalFlushInFlight) {
      await globalFlushInFlight;
    }
  };

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
          if (globalBatchingEnabled) {
            computed = await enqueueGlobalBatchRequest({
              texts: computeTexts,
              label,
              tokenEstimates
            });
          } else {
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
          }
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

  const processor = async (entry) => {
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
  processor.drain = async () => {
    await drainGlobalBatching();
  };
  return processor;
};
