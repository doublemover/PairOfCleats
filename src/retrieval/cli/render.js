import { compactHit } from './render-output.js';
import { formatFullChunk, formatShortChunk, getOutputCacheReporter } from '../output.js';
import { applyOutputBudgetPolicy, normalizeOutputBudgetPolicy } from '../output/score-breakdown.js';
import { buildTrustSurface } from '../output/explain.js';

export function renderSearchOutput({
  emitOutput,
  jsonOutput,
  jsonCompact,
  explain,
  color,
  rootDir,
  backendLabel,
  backendPolicyInfo,
  routingPolicy = null,
  runCode,
  runProse,
  runExtractedProse,
  runRecords,
  topN,
  queryTokens,
  highlightRegex,
  contextExpansionEnabled,
  expandedHits,
  baseHits,
  annEnabled,
  annActive,
  annBackend,
  vectorExtension,
  vectorAnnEnabled,
  vectorAnnState,
  vectorAnnUsed,
  hnswConfig,
  hnswAnnState,
  lanceAnnState,
  modelIds,
  embeddingProvider,
  embeddingOnnx,
  cacheInfo,
  profileInfo = null,
  intentInfo,
  resolvedDenseVectorMode,
  fieldWeights,
  contextExpansionStats,
  idxProse,
  idxExtractedProse,
  idxCode,
  idxRecords,
  showStats,
  showMatched,
  verboseCache,
  elapsedMs,
  stageTracker,
  outputBudget = null,
  asOfContext = null,
  streamJson = false
}) {
  const outputStart = stageTracker?.mark?.();
  const proseHitsFinal = expandedHits.prose.hits;
  const extractedProseHitsFinal = expandedHits.extractedProse.hits;
  const codeHitsFinal = expandedHits.code.hits;
  const recordHitsFinal = expandedHits.records.hits;

  const stripTokensInPlace = (hit) => {
    if (!hit || typeof hit !== 'object') return hit;
    if ('tokens' in hit) delete hit.tokens;
    if (Array.isArray(hit.context)) {
      hit.context.forEach(stripTokensInPlace);
    }
    if (Array.isArray(hit.contextHits)) {
      hit.contextHits.forEach(stripTokensInPlace);
    }
    return hit;
  };
  const sanitize = (hits) => {
    if (!jsonOutput || jsonCompact) return hits;
    hits.forEach(stripTokensInPlace);
    return hits;
  };

  const includeStats = showStats || explain;
  const memory = includeStats ? process.memoryUsage() : null;
  const allowSummary = !jsonOutput && (contextExpansionEnabled || showMatched || explain || showStats);
  const payload = {
    backend: backendLabel,
    prose: jsonCompact ? proseHitsFinal.map((hit) => compactHit(hit, explain)) : sanitize(proseHitsFinal),
    extractedProse: jsonCompact
      ? extractedProseHitsFinal.map((hit) => compactHit(hit, explain))
      : sanitize(extractedProseHitsFinal),
    code: jsonCompact ? codeHitsFinal.map((hit) => compactHit(hit, explain)) : sanitize(codeHitsFinal),
    records: jsonCompact ? recordHitsFinal.map((hit) => compactHit(hit, explain)) : sanitize(recordHitsFinal)
  };
  if (asOfContext) {
    payload.asOf = {
      ref: asOfContext.ref || 'latest',
      identityHash: asOfContext.identityHash || null,
      resolved: asOfContext.summary || { type: asOfContext.type || 'latest' }
    };
  }

  if (outputStart) {
    stageTracker?.record?.('output', outputStart, { mode: 'all' });
  }
  if (includeStats) {
    const vectorAnnActive = vectorAnnEnabled
      && (vectorAnnUsed.code
        || vectorAnnUsed.prose
        || vectorAnnUsed.records
        || vectorAnnUsed['extracted-prose']);
    payload.stats = {
      elapsedMs,
      annEnabled,
      annActive,
      annMode: vectorAnnActive ? 'extension' : vectorExtension.annMode,
      annBackend,
      backendPolicy: backendPolicyInfo,
      routingPolicy,
      annExtension: vectorAnnEnabled ? {
        provider: vectorExtension.provider,
        table: vectorExtension.table,
        available: {
          code: vectorAnnState.code.available,
          prose: vectorAnnState.prose.available,
          records: vectorAnnState.records.available,
          extractedProse: vectorAnnState['extracted-prose']?.available ?? false
        }
      } : null,
      annLance: lanceAnnState ? {
        available: {
          code: lanceAnnState.code.available,
          prose: lanceAnnState.prose.available,
          records: lanceAnnState.records.available,
          extractedProse: lanceAnnState['extracted-prose'].available
        },
        metric: lanceAnnState.code.metric || lanceAnnState.prose.metric || null
      } : null,
      annHnsw: hnswConfig.enabled ? {
        available: {
          code: hnswAnnState.code.available,
          prose: hnswAnnState.prose.available,
          records: hnswAnnState.records.available,
          extractedProse: hnswAnnState['extracted-prose'].available
        },
        space: hnswConfig.space,
        efSearch: hnswConfig.efSearch
      } : null,
      models: {
        code: modelIds.code,
        prose: modelIds.prose,
        extractedProse: modelIds.extractedProse,
        records: modelIds.records
      },
      embeddings: {
        provider: embeddingProvider,
        onnxModel: embeddingOnnx.modelPath || null,
        onnxTokenizer: embeddingOnnx.tokenizerId || null
      },
      cache: {
        enabled: cacheInfo.enabled,
        hit: cacheInfo.hit,
        key: cacheInfo.key
      },
      profile: profileInfo,
      capabilities: {
        routing: routingPolicy,
        ann: {
          extensionEnabled: vectorAnnEnabled,
          extensionAvailable: vectorAnnState
        }
      },
      asOf: asOfContext
        ? {
          ref: asOfContext.ref || 'latest',
          type: asOfContext.type || 'latest',
          identityHash: asOfContext.identityHashShort || String(asOfContext.identityHash || '').slice(0, 8) || null
        }
        : null,
      memory: memory
        ? {
          rss: memory.rss,
          heapTotal: memory.heapTotal,
          heapUsed: memory.heapUsed,
          external: memory.external,
          arrayBuffers: memory.arrayBuffers
        }
        : null
    };
    if (stageTracker?.stages?.length) {
      payload.stats.pipeline = stageTracker.stages;
    }
  }

  if (explain) {
    const allExplainHits = [
      ...(Array.isArray(payload?.code) ? payload.code : []),
      ...(Array.isArray(payload?.prose) ? payload.prose : []),
      ...(Array.isArray(payload?.extractedProse) ? payload.extractedProse : []),
      ...(Array.isArray(payload?.records) ? payload.records : [])
    ];
    const firstRelationBoost = allExplainHits.find((hit) => hit?.scoreBreakdown?.relation)?.scoreBreakdown?.relation || null;
    const firstLexiconStatus = firstRelationBoost?.lexicon || null;
    const firstAnnCandidatePolicy = allExplainHits.find((hit) => hit?.scoreBreakdown?.ann?.candidatePolicy)
      ?.scoreBreakdown?.ann?.candidatePolicy || null;
    payload.stats = payload.stats || {};
    payload.stats.intent = {
      ...intentInfo,
      denseVectorMode: resolvedDenseVectorMode,
      fieldWeights
    };
    payload.stats.contextExpansion = contextExpansionStats;
    payload.stats.routing = routingPolicy;
    payload.stats.relationBoost = firstRelationBoost;
    payload.stats.lexicon = firstLexiconStatus;
    payload.stats.annCandidatePolicy = firstAnnCandidatePolicy;
    payload.stats.trust = buildTrustSurface({
      intentInfo,
      contextExpansionStats,
      annCandidatePolicy: firstAnnCandidatePolicy
    });
  }

  const budgetPolicy = normalizeOutputBudgetPolicy(outputBudget);
  const outputPayload = applyOutputBudgetPolicy(payload, budgetPolicy);

  if (emitOutput && jsonOutput) {
    const totalHits = outputPayload.prose.length
      + outputPayload.extractedProse.length
      + outputPayload.code.length
      + outputPayload.records.length;
    const shouldStream = streamJson || totalHits >= 500;
    if (shouldStream) {
      const out = process.stdout;
      const writeArray = (arr) => {
        out.write('[');
        arr.forEach((item, index) => {
          if (index > 0) out.write(',');
          out.write(JSON.stringify(item));
        });
        out.write(']');
      };
      out.write('{');
      out.write(`\"backend\":${JSON.stringify(outputPayload.backend)}`);
      out.write(',\"prose\":');
      writeArray(outputPayload.prose);
      out.write(',\"extractedProse\":');
      writeArray(outputPayload.extractedProse);
      out.write(',\"code\":');
      writeArray(outputPayload.code);
      out.write(',\"records\":');
      writeArray(outputPayload.records);
      if (outputPayload.asOf) {
        out.write(',\"asOf\":');
        out.write(JSON.stringify(outputPayload.asOf));
      }
      if (outputPayload.stats) {
        out.write(',\"stats\":');
        out.write(JSON.stringify(outputPayload.stats));
      }
      out.write('}\n');
    } else {
      console.log(JSON.stringify(outputPayload));
    }
  }

  if (emitOutput && !jsonOutput) {
    if (asOfContext?.provided) {
      const shortHash = asOfContext.identityHashShort || String(asOfContext.identityHash || '').slice(0, 8);
      console.error(`[search] as-of: ${asOfContext.ref || 'latest'} (identity ${shortHash})`);
    }
    const makeSectionHeader = (label) => {
      const bar = '─';
      const width = 94;
      const text = ` ${label} `;
      const left = Math.max(1, Math.floor((width - text.length) / 2));
      const right = Math.max(1, width - text.length - left);
      return `${bar.repeat(left)}${text}${bar.repeat(right)}`;
    };
    let showProse = runProse ? topN : 0;
    let showExtractedProse = runExtractedProse ? topN : 0;
    let showCode = runCode ? topN : 0;
    let showRecords = runRecords ? topN : 0;

    if (runProse && runCode) {
      if (baseHits.proseHits.length < topN) {
        showCode += showProse;
      }
      if (baseHits.codeHits.length < topN) {
        showProse += showCode;
      }
    }
    if (contextExpansionEnabled) {
      showProse += expandedHits.prose.contextHits.length;
      showExtractedProse += expandedHits.extractedProse.contextHits.length;
      showCode += expandedHits.code.contextHits.length;
      showRecords += expandedHits.records.contextHits.length;
    }

    if (runCode) {
      const backendSuffix = explain ? ` (${backendLabel})` : '';
      console.error(color.bold(`\n${makeSectionHeader(`Code Results${backendSuffix}`)}`));
      const summaryState = { lastCount: 0 };
      codeHitsFinal.slice(0, showCode).forEach((hit, index) => {
        if (index < 1) {
          process.stderr.write(formatFullChunk({
            chunk: hit,
            index,
            mode: 'code',
            score: hit.score,
            scoreType: hit.scoreType,
            explain,
            color,
            queryTokens,
            rx: highlightRegex,
            matched: showMatched,
            rootDir,
            summaryState,
            allowSummary
          }));
        } else {
          process.stderr.write(formatShortChunk({
            chunk: hit,
            index,
            mode: 'code',
            score: hit.score,
            scoreType: hit.scoreType,
            explain,
            color,
            queryTokens,
            rx: highlightRegex,
            matched: showMatched
          }));
        }
      });
      console.error('\n');
    }

    if (runExtractedProse) {
      const backendSuffix = explain ? ` (${backendLabel})` : '';
      console.error(color.bold(makeSectionHeader(`Code Comments Results${backendSuffix}`)));
      const summaryState = { lastCount: 0 };
      extractedProseHitsFinal.slice(0, showExtractedProse).forEach((hit, index) => {
        if (index < 2) {
          process.stderr.write(formatFullChunk({
            chunk: hit,
            index,
            mode: 'extracted-prose',
            score: hit.score,
            scoreType: hit.scoreType,
            explain,
            color,
            queryTokens,
            rx: highlightRegex,
            matched: showMatched,
            rootDir,
            summaryState,
            allowSummary
          }));
        } else {
          process.stderr.write(formatShortChunk({
            chunk: hit,
            index,
            mode: 'extracted-prose',
            score: hit.score,
            scoreType: hit.scoreType,
            explain,
            color,
            queryTokens,
            rx: highlightRegex,
            matched: showMatched
          }));
        }
      });
      console.error('\n');
    }

    if (runProse) {
      const backendSuffix = explain ? ` (${backendLabel})` : '';
      console.error(color.bold(makeSectionHeader(`Text Search Results${backendSuffix}`)));
      const summaryState = { lastCount: 0 };
      proseHitsFinal.slice(0, showProse).forEach((hit, index) => {
        if (index < 2) {
          process.stderr.write(formatFullChunk({
            chunk: hit,
            index,
            mode: 'prose',
            score: hit.score,
            scoreType: hit.scoreType,
            explain,
            color,
            queryTokens,
            rx: highlightRegex,
            matched: showMatched,
            rootDir,
            summaryState,
            allowSummary
          }));
        } else {
          process.stderr.write(formatShortChunk({
            chunk: hit,
            index,
            mode: 'prose',
            score: hit.score,
            scoreType: hit.scoreType,
            explain,
            color,
            queryTokens,
            rx: highlightRegex,
            matched: showMatched
          }));
        }
      });
      console.error('\n');
    }

    if (runRecords) {
      console.error(color.bold(`===== Records Results (${backendLabel}) =====`));
      recordHitsFinal.slice(0, showRecords).forEach((hit, index) => {
        if (index < 2) {
          process.stderr.write(formatFullChunk({
            chunk: hit,
            index,
            mode: 'records',
            score: hit.score,
            scoreType: hit.scoreType,
            explain,
            color,
            queryTokens,
            rx: highlightRegex,
            matched: showMatched,
            rootDir: null,
            summaryState: null
          }));
        } else {
          process.stderr.write(formatShortChunk({
            chunk: hit,
            index,
            mode: 'records',
            score: hit.score,
            scoreType: hit.scoreType,
            explain,
            color,
            queryTokens,
            rx: highlightRegex,
            matched: showMatched
          }));
        }
      });
      console.error('\n');
    }

    if (showStats) {
      const proseCount = idxProse?.chunkMeta?.length ?? 0;
      const codeCount = idxCode?.chunkMeta?.length ?? 0;
      const extractedProseCount = idxExtractedProse?.chunkMeta?.length ?? 0;
      const recordsCount = idxRecords?.chunkMeta?.length ?? 0;
      const cacheTag = cacheInfo.enabled ? (cacheInfo.hit ? 'cache=hit' : 'cache=miss') : 'cache=off';
      const statsParts = [
        `prose chunks=${proseCount}`,
        `code chunks=${codeCount}`,
        runExtractedProse ? `extracted-prose chunks=${extractedProseCount}` : null,
        runRecords ? `records chunks=${recordsCount}` : null,
        `(${cacheTag})`
      ].filter(Boolean);
      if (explain && backendPolicyInfo?.reason) {
        statsParts.push(`backend=${backendLabel}`);
        statsParts.push(`policy=${backendPolicyInfo.reason}`);
      }
      console.error(color.gray(`Stats: ${statsParts.join(', ')}`));
    }
  }

  const outputCacheReporter = getOutputCacheReporter();
  if (emitOutput && verboseCache && outputCacheReporter) {
    outputCacheReporter.report();
  }

  return outputPayload;
}
