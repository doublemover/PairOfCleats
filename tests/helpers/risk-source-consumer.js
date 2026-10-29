import { detectRiskSignals, normalizeRiskConfig } from '../../src/index/risk.js';
import { buildRiskSummaries } from '../../src/index/risk-interprocedural/summaries.js';
import { computeInterproceduralRisk } from '../../src/index/risk-interprocedural/engine.js';
import { createCallSites } from '../../src/index/build/artifacts/writers/call-sites.js';
import { prepareChunkIds } from '../../src/index/build/file-processor/process-chunks/ids.js';
import { buildLineIndex } from '../../src/shared/lines.js';

/** Actual local detector -> summary -> interprocedural engine on two authored
 * source chunks. Unknown cross-file coverage remains unknown; this helper does
 * not invent a complete compiler/provider receipt to make strict packs green. */
export const createRiskSourceConsumerCase = async ({ caps = {}, sourceText = 'const value=SOURCE;\nS(value);', clockStep = null } = {}) => {
  const sinkText = 'SINK(value);';
  const rules = { includeDefaults: false, rules: { sources: [{ id: 'source.input', name: 'input', patterns: ['SOURCE'] }],
    sinks: [{ id: 'sink.exec', name: 'exec', patterns: ['SINK\\b'] }, { id: 'sink.other', name: 'other', patterns: ['SINK_ALT'] }], sanitizers: [] } };
  const config = normalizeRiskConfig({ rules, caps: { maxBytes: 10000, maxLines: 1000, maxNodes: 1000, maxEdges: 1000, maxFlows: 1000, maxMs: 10000, ...caps } });
  const detect = (text, timed) => {
    const now = Date.now; let ticks = 0;
    try { if (timed) Date.now = () => ticks++ * clockStep;
      return detectRiskSignals({ text, languageId: 'javascript', config });
    } finally { Date.now = now; }
  };
  const sourceRisk = detect(sourceText, clockStep !== null), sinkRisk = detectRiskSignals({ text: sinkText, languageId: 'javascript',
    config: normalizeRiskConfig({ rules, caps: { maxBytes: 10000, maxLines: 1000, maxNodes: 1000, maxEdges: 1000, maxFlows: 1000, maxMs: 10000 } }) });
  const chunks = [{ id: 0, chunkUid: 'chunk-primary', virtualPath: 'src/actual-source.js', file: 'src/actual-source.js', ext: '.js',
    lang: 'javascript', name: 'R', kind: 'Function', start: 0, end: sourceText.length, startLine: 1, endLine: sourceText.split('\n').length,
    tokens: ['source'], docmeta: { risk: sourceRisk }, codeRelations: { callDetails: [{ callee: 'S', calleeRaw: 'S', calleeNormalized: 'S',
      targetChunkUid: 'chunk-sink', args: ['value'], startLine: 2, startCol: 1, endLine: 2, endCol: 9 }] } },
  { id: 1, chunkUid: 'chunk-sink', virtualPath: 'src/actual-sink.js', file: 'src/actual-sink.js', ext: '.js', lang: 'javascript', name: 'S', kind: 'Function',
    start: 0, end: sinkText.length, startLine: 1, endLine: 1, tokens: ['sink'], docmeta: { risk: sinkRisk } }];
  for (const [index, chunk] of chunks.entries()) await prepareChunkIds({ chunks: [chunk], text: index ? sinkText : sourceText,
    relKey: chunk.file, containerExt: '.js', containerLanguageId: 'javascript', lineIndex: buildLineIndex(index ? sinkText : sourceText),
    vfsManifestConcurrency: 1, strict: true });
  chunks[0].codeRelations.callDetails[0].targetChunkUid = chunks[1].chunkUid;
  const runtime = { riskConfig: config, riskInterproceduralEnabled: true, riskInterproceduralConfig: {
    enabled: true, summaryOnly: false, strictness: 'conservative', sanitizerPolicy: 'terminate', emitArtifacts: 'jsonl',
    caps: { maxDepth: 4, maxTotalFlows: 20, maxPathsPerPair: 3, maxCallSitesPerEdge: 2, maxEdgeExpansions: 20, maxMs: null } } };
  const summaries = buildRiskSummaries({ chunks, runtime, mode: 'code' });
  const result = computeInterproceduralRisk({ chunks, summaries: summaries.rows, summaryStats: summaries.stats, runtime });
  return { chunks, runtime, result, summaries, sourceText, sinkText, callSites: createCallSites({ chunks }) };
};
