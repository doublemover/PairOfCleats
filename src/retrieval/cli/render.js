import { compactHit } from './render-output.js';
import { formatFullChunk, formatShortChunk, getOutputCacheReporter } from '../output.js';

export function renderSearchOutput({
  emitOutput,
  jsonOutput,
  jsonCompact,
  explain,
  color,
  rootDir,
  backendLabel,
  backendPolicyInfo,
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
  modelIds,
  embeddingProvider,
  embeddingOnnx,
  cacheInfo,
  intentInfo,
  resolvedDenseVectorMode,
  fieldWeights,
  contextExpansionStats,
  idxProse,
  idxCode,
  idxRecords,
  showStats,
  showMatched,
  verboseCache,
  elapsedMs
}) {
  const proseHitsFinal = expandedHits.prose.hits;
  const extractedProseHitsFinal = expandedHits.extractedProse.hits;
  const codeHitsFinal = expandedHits.code.hits;
  const recordHitsFinal = expandedHits.records.hits;

  const memory = process.memoryUsage();
  const payload = {
    backend: backendLabel,
    prose: jsonCompact ? proseHitsFinal.map((hit) => compactHit(hit, explain)) : proseHitsFinal,
    extractedProse: jsonCompact
      ? extractedProseHitsFinal.map((hit) => compactHit(hit, explain))
      : extractedProseHitsFinal,
    code: jsonCompact ? codeHitsFinal.map((hit) => compactHit(hit, explain)) : codeHitsFinal,
    records: jsonCompact ? recordHitsFinal.map((hit) => compactHit(hit, explain)) : recordHitsFinal,
    stats: {
      elapsedMs,
      annEnabled,
      annActive,
      annMode: vectorExtension.annMode,
      annBackend,
      backendPolicy: backendPolicyInfo,
      annExtension: vectorAnnEnabled ? {
        provider: vectorExtension.provider,
        table: vectorExtension.table,
        available: {
          code: vectorAnnState.code.available,
          prose: vectorAnnState.prose.available,
          records: vectorAnnState.records.available
        }
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
      memory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers
      }
    }
  };

  if (explain) {
    payload.stats.intent = {
      ...intentInfo,
      denseVectorMode: resolvedDenseVectorMode,
      fieldWeights
    };
    payload.stats.contextExpansion = contextExpansionStats;
  }

  if (emitOutput && jsonOutput) {
    console.log(JSON.stringify(payload, null, 2));
  }

  if (emitOutput && !jsonOutput) {
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

    if (runProse) {
      console.log(color.bold(`\n===== Markdown Results (${backendLabel}) =====`));
      const summaryState = { lastCount: 0 };
      proseHitsFinal.slice(0, showProse).forEach((hit, index) => {
        if (index < 2) {
          process.stdout.write(formatFullChunk({
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
            summaryState
          }));
        } else {
          process.stdout.write(formatShortChunk({
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
      console.log('\n');
    }

    if (runExtractedProse) {
      console.log(color.bold(`===== Extracted Prose Results (${backendLabel}) =====`));
      const summaryState = { lastCount: 0 };
      extractedProseHitsFinal.slice(0, showExtractedProse).forEach((hit, index) => {
        if (index < 2) {
          process.stdout.write(formatFullChunk({
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
            summaryState
          }));
        } else {
          process.stdout.write(formatShortChunk({
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
      console.log('\n');
    }

    if (runCode) {
      console.log(color.bold(`===== Code Results (${backendLabel}) =====`));
      const summaryState = { lastCount: 0 };
      codeHitsFinal.slice(0, showCode).forEach((hit, index) => {
        if (index < 1) {
          process.stdout.write(formatFullChunk({
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
            summaryState
          }));
        } else {
          process.stdout.write(formatShortChunk({
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
      console.log('\n');
    }

    if (runRecords) {
      console.log(color.bold(`===== Records Results (${backendLabel}) =====`));
      recordHitsFinal.slice(0, showRecords).forEach((hit, index) => {
        if (index < 2) {
          process.stdout.write(formatFullChunk({
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
          process.stdout.write(formatShortChunk({
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
      console.log('\n');
    }

    if (showStats) {
      const proseCount = idxProse?.chunkMeta?.length ?? 0;
      const codeCount = idxCode?.chunkMeta?.length ?? 0;
      const recordsCount = idxRecords?.chunkMeta?.length ?? 0;
      const cacheTag = cacheInfo.enabled ? (cacheInfo.hit ? 'cache=hit' : 'cache=miss') : 'cache=off';
      const statsParts = [
        `prose chunks=${proseCount}`,
        `code chunks=${codeCount}`,
        runRecords ? `records chunks=${recordsCount}` : null,
        `(${cacheTag})`
      ].filter(Boolean);
      if (explain && backendPolicyInfo?.reason) {
        statsParts.push(`backend=${backendLabel}`);
        statsParts.push(`policy=${backendPolicyInfo.reason}`);
      }
      console.log(color.gray(`Stats: ${statsParts.join(', ')}`));
    }
  }

  const outputCacheReporter = getOutputCacheReporter();
  if (emitOutput && verboseCache && outputCacheReporter) {
    outputCacheReporter.report();
  }

  return payload;
}
