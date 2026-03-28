import { compactHit } from './render-output.js';
import {
  buildResultBundles,
  colorText,
  formatFullChunk,
  formatShortChunk,
  getOutputCacheReporter,
  stripAnsi
} from '../output.js';
import { applyOutputBudgetPolicy, normalizeOutputBudgetPolicy } from '../output/score-breakdown.js';
import { buildTrustSurface } from '../output/explain.js';
import { buildRetrievalMetadata } from '../output/retrieval-metadata.js';
import { ANSI } from '../../shared/cli/ansi-utils.js';

const FALLBACK_TERMINAL_COLUMNS = 108;
const INDENT = '  ';

const resolveTerminalColumns = (stream = process.stdout) => {
  const envColumns = Number.parseInt(String(process.env.COLUMNS || ''), 10);
  if (Number.isFinite(envColumns) && envColumns >= 40) {
    return envColumns;
  }
  const streamColumns = Number.parseInt(String(stream?.columns ?? ''), 10);
  if (Number.isFinite(streamColumns) && streamColumns >= 40) {
    return streamColumns;
  }
  return FALLBACK_TERMINAL_COLUMNS;
};

const resolveHumanLayout = (stream = process.stdout) => {
  const columns = resolveTerminalColumns(stream);
  return {
    columns,
    contentWidth: Math.max(54, columns - 4),
    isNarrow: columns <= 88,
    isMedium: columns > 88 && columns <= 128,
    isWide: columns >= 160,
    cacheKey: `cols:${columns}`
  };
};

const writeLine = (stream, value = '') => {
  stream.write(`${value}\n`);
};

const wrapWords = (text, { width, firstPrefix = '', restPrefix = firstPrefix } = {}) => {
  const words = String(text || '').trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return [firstPrefix.trimEnd()];
  const lines = [];
  let prefix = firstPrefix;
  let line = prefix;
  for (const word of words) {
    const separator = line === prefix ? '' : ' ';
    const candidate = `${line}${separator}${word}`;
    if (stripAnsi(candidate).length > width && line !== prefix) {
      lines.push(line);
      prefix = restPrefix;
      line = `${prefix}${word}`;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
};

const buildWrappedSummaryLines = (parts, { width }) => {
  const lines = [];
  const separator = colorText('  •  ', ANSI.fgDarkGray);
  let line = '';
  for (const part of parts.filter(Boolean)) {
    if (!line) {
      line = part;
      continue;
    }
    const candidate = `${line}${separator}${part}`;
    if (stripAnsi(candidate).length > width && line) {
      lines.push(line);
      line = part;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
};

const formatCountSummary = (entries, color) => entries
  .filter((entry) => entry && entry.count > 0)
  .map((entry) => (
    `${color.bold(String(entry.count))} ${colorText(entry.label, ANSI.fgDarkGray)}`
  ))
  .join(colorText('  •  ', ANSI.fgDarkGray));

const makeRule = (columns) => colorText('─'.repeat(Math.max(12, columns)), ANSI.fgDarkGray);

const alignLine = (left, right, width) => {
  if (!right) return left;
  const leftWidth = stripAnsi(left).length;
  const rightWidth = stripAnsi(right).length;
  if (leftWidth + rightWidth + 2 > width) {
    return `${left}\n${right}`;
  }
  return `${left}${' '.repeat(Math.max(1, width - leftWidth - rightWidth))}${right}`;
};

const makeSectionHeader = ({ label, count, color, layout }) => {
  const title = color.bold(`${label} (${count})`);
  const titleWidth = stripAnsi(title).length;
  const ruleWidth = Math.max(0, layout.columns - titleWidth - 1);
  if (ruleWidth <= 0) return title;
  return `${title} ${colorText('─'.repeat(ruleWidth), ANSI.fgDarkGray)}`;
};

const parseDiagnosticKv = (text) => {
  const pairs = {};
  const pattern = /(\w+)=("([^"]*)"|[^\s]+)/gu;
  for (const match of text.matchAll(pattern)) {
    pairs[match[1]] = match[3] ?? match[2];
  }
  return pairs;
};

const formatMiB = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)} MiB` : null;
};

const normalizeDiagnosticEntries = (profileInfo) => {
  const rawEntries = Array.isArray(profileInfo?.warnings)
    ? profileInfo.warnings.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  return rawEntries.map((entry) => {
    if (!entry.startsWith('[ops-resource]')) {
      return { kind: 'warning', message: entry };
    }
    const parsed = parseDiagnosticKv(entry);
    return {
      kind: 'resource',
      code: parsed.code || null,
      component: parsed.component || null,
      metric: parsed.metric || null,
      baselineMiB: formatMiB(parsed.baselineMiB),
      currentMiB: formatMiB(parsed.currentMiB),
      deltaMiB: formatMiB(parsed.deltaMiB),
      ratio: parsed.ratio ? `${parsed.ratio}x` : null,
      next: parsed.next || null
    };
  });
};

const formatDiagnosticEntry = (entry, { layout, color }) => {
  if (entry.kind === 'resource') {
    const detail = [
      entry.component ? `component ${entry.component}` : null,
      entry.metric ? `metric ${entry.metric}` : null,
      entry.ratio ? `growth ${entry.ratio}` : null,
      entry.deltaMiB ? `delta +${entry.deltaMiB}` : null,
      entry.baselineMiB && entry.currentMiB ? `${entry.baselineMiB} -> ${entry.currentMiB}` : null
    ].filter(Boolean).join('  •  ');
    const lines = [];
    lines.push(...wrapWords(
      detail || 'resource warning',
      {
        width: layout.columns,
        firstPrefix: `${color.yellow('!')} ${color.bold('Resource')}: `,
        restPrefix: '    '
      }
    ));
    if (entry.next) {
      lines.push(...wrapWords(
        entry.next,
        {
          width: layout.columns,
          firstPrefix: `    ${colorText('next', ANSI.fgDarkGray)} `,
          restPrefix: '         '
        }
      ));
    }
    return lines;
  }
  return wrapWords(entry.message, {
    width: layout.columns,
    firstPrefix: `${color.yellow('!')} `,
    restPrefix: '  '
  });
};

const buildHumanSections = ({
  runCode,
  runExtractedProse,
  runProse,
  runRecords,
  explain,
  backendLabel,
  codeHits,
  extractedProseHits,
  proseHits,
  recordHits
}) => {
  const backendSuffix = explain ? ` (${backendLabel})` : '';
  const sections = [];
  if (runCode && codeHits.length) {
    sections.push({ key: 'code', label: `Code Results${backendSuffix}`, mode: 'code', hits: codeHits, fullCount: 1 });
  }
  if (runExtractedProse && extractedProseHits.length) {
    sections.push({
      key: 'extracted-prose',
      label: `Code Comments Results${backendSuffix}`,
      mode: 'extracted-prose',
      hits: extractedProseHits,
      fullCount: 2
    });
  }
  if (runProse && proseHits.length) {
    sections.push({ key: 'prose', label: `Text Results${backendSuffix}`, mode: 'prose', hits: proseHits, fullCount: 2 });
  }
  if (runRecords && recordHits.length) {
    sections.push({ key: 'records', label: `Records Results${backendSuffix}`, mode: 'records', hits: recordHits, fullCount: 2 });
  }
  return sections;
};

/**
 * Render retrieval results in JSON or TTY format and append derived output
 * sections (bundles, stats, explain/trust surfaces) before emission.
 * Large JSON responses can stream directly to stdout to reduce peak memory.
 *
 * @param {object} input
 * @returns {object}
 */
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
  indexSignaturePayload = null,
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
  streamJson = false,
  generationContext = null,
  hyperlinkMode = null
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
  payload.bundles = buildResultBundles({
    code: payload.code,
    extractedProse: payload.extractedProse,
    prose: payload.prose,
    records: payload.records
  });
  payload.retrieval = buildRetrievalMetadata({
    backendLabel,
    backendPolicyInfo,
    cacheInfo,
    idxCode,
    idxProse,
    idxExtractedProse,
    idxRecords,
    indexSignaturePayload,
    asOfContext,
    generationContext
  });
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
    if (intentInfo && typeof intentInfo === 'object') {
      payload.stats.intent = {
        type: intentInfo.type || null,
        effectiveType: intentInfo.effectiveType || intentInfo.type || null,
        confidence: Number.isFinite(Number(intentInfo.confidence)) ? Number(intentInfo.confidence) : null,
        confidenceBucket: intentInfo.confidenceBucket || null,
        parseStrategy: intentInfo.parseStrategy || null,
        parseFallbackReason: intentInfo.parseFallbackReason || null,
        missTaxonomy: intentInfo.missTaxonomy || null
      };
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
      out.write(',\"bundles\":');
      out.write(JSON.stringify(outputPayload.bundles));
      if (outputPayload.retrieval) {
        out.write(',\"retrieval\":');
        out.write(JSON.stringify(outputPayload.retrieval));
      }
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
    const outputStream = process.stdout;
    const layout = resolveHumanLayout(outputStream);
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

    const sectionInputs = buildHumanSections({
      runCode,
      runExtractedProse,
      runProse,
      runRecords,
      explain,
      backendLabel,
      codeHits: codeHitsFinal.slice(0, showCode),
      extractedProseHits: extractedProseHitsFinal.slice(0, showExtractedProse),
      proseHits: proseHitsFinal.slice(0, showProse),
      recordHits: recordHitsFinal.slice(0, showRecords)
    });

    const countSummary = formatCountSummary([
      { label: 'code', count: codeHitsFinal.length },
      { label: 'comments', count: extractedProseHitsFinal.length },
      { label: 'text', count: proseHitsFinal.length },
      { label: 'records', count: recordHitsFinal.length }
    ], color);
    writeLine(
      outputStream,
      alignLine(
        color.bold('Search Results'),
        `${colorText('elapsed', ANSI.fgDarkGray)} ${color.bold(`${elapsedMs}ms`)}`,
        layout.columns
      )
    );
    if (queryTokens.length) {
      writeLine(outputStream, `${colorText('query', ANSI.fgDarkGray)} ${color.bold(queryTokens.join(' '))}`);
    }
    const backendModeLines = buildWrappedSummaryLines([
      `${colorText('backend', ANSI.fgDarkGray)} ${backendLabel}`,
      `${colorText('modes', ANSI.fgDarkGray)} ${[
        runCode ? 'code' : null,
        runExtractedProse ? 'comments' : null,
        runProse ? 'text' : null,
        runRecords ? 'records' : null
      ].filter(Boolean).join(', ')}`
    ], { width: layout.columns });
    backendModeLines.forEach((line) => writeLine(outputStream, line));
    if (countSummary) {
      writeLine(outputStream, `${colorText('hits', ANSI.fgDarkGray)} ${countSummary}`);
    }
    if (asOfContext?.provided) {
      const shortHash = asOfContext.identityHashShort || String(asOfContext.identityHash || '').slice(0, 8);
      writeLine(
        outputStream,
        `${colorText('as-of', ANSI.fgDarkGray)} ${asOfContext.ref || 'latest'} ${colorText(`(${shortHash})`, ANSI.fgDarkGray)}`
      );
    }
    writeLine(outputStream, makeRule(layout.columns));
    writeLine(outputStream);

    if (!sectionInputs.length) {
      writeLine(outputStream, color.yellow('No results matched the current query.'));
      writeLine(outputStream);
    }

    for (const section of sectionInputs) {
      writeLine(outputStream, makeSectionHeader({
        label: section.label,
        count: section.hits.length,
        color,
        layout
      }));
      const summaryState = section.mode === 'records' ? null : { lastCount: 0 };
      section.hits.forEach((hit, index) => {
        const formatArgs = {
          chunk: hit,
          index,
          mode: section.mode,
          score: hit.score,
          scoreType: hit.scoreType,
          explain,
          color,
          queryTokens,
          rx: highlightRegex,
          matched: showMatched,
          layout,
          hyperlinkMode
        };
        if (index < section.fullCount) {
          outputStream.write(formatFullChunk({
            ...formatArgs,
            rootDir: section.mode === 'records' ? null : rootDir,
            summaryState,
            allowSummary
          }));
        } else {
          outputStream.write(formatShortChunk({
            ...formatArgs,
            rootDir: section.mode === 'records' ? null : rootDir
          }));
        }
      });
      writeLine(outputStream);
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
      writeLine(outputStream, color.gray(`Stats: ${statsParts.join(', ')}`));
    }

    const diagnostics = normalizeDiagnosticEntries(profileInfo);
    if (diagnostics.length) {
      writeLine(outputStream, makeSectionHeader({
        label: 'Diagnostics',
        count: diagnostics.length,
        color,
        layout
      }));
      for (const entry of diagnostics) {
        for (const line of formatDiagnosticEntry(entry, { layout, color })) {
          writeLine(outputStream, line);
        }
      }
      writeLine(outputStream);
    }
  }

  const outputCacheReporter = getOutputCacheReporter();
  if (emitOutput && verboseCache && outputCacheReporter) {
    outputCacheReporter.report();
  }

  return outputPayload;
}
