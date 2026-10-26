import { buildChunkEnrichment } from '../../src/index/build/file-processor/process-chunks/index.js';
import { buildChunkPayload } from '../../src/index/build/file-processor/assemble.js';
import { buildTokenSequence } from '../../src/index/build/tokenization.js';

const noop = () => {};
export const enrichFlowFixture = ({ text, chunk, lang, context = {}, options = {}, enabled = true, fileRelations = null, callIndex = null,
  relationsEnabled = false, segmentRelationsCache = null, sourceLineIndex = null, returnResult = false }) => {
  const result = buildChunkEnrichment({ chunkMode: 'code', text, chunkText: text.slice(chunk.start, chunk.end), chunk,
    chunkIndex: 0, activeLang: lang, activeContext: context, languageOptions: options, fileRelations, callIndex,
    relationsEnabled, segmentRelationsCache, sourceLineIndex, fileStructural: null, chunkLineCount: 1, chunkLanguageId: lang.id,
    resolvedTypeInferenceEnabled: false, resolvedRiskAnalysisEnabled: false, riskConfig: {}, astDataflowEnabled: enabled,
    controlFlowEnabled: enabled, addSettingMetric: noop, addEnrichDuration: noop, updateCrashStage: noop,
    failFile: (_reason, _stage, error) => { throw error; }, diagnostics: [], startLine: 1, endLine: 1, totalLines: 1 });
  if (result.skip) throw new Error('Unexpected fixture enrichment skip.');
  return returnResult ? result : result.docmeta;
};

export const assembleFlowFixture = ({ text, chunk, docmeta, lang = 'groovy', ext = '.groovy', codeRelations = {}, emitFieldTokens = false }) => {
  const tokenized = buildTokenSequence({ text: text.slice(chunk.start, chunk.end), mode: 'code', ext,
    dictWords: new Set(), dictConfig: {}, includeSeq: true });
  return buildChunkPayload({
    chunk: { ...chunk, chunkUid: 'flow-fixture:' + chunk.start, startLine: chunk.meta?.startLine || 1, endLine: chunk.meta?.endLine || 1, spanIndex: 0 },
    rel: 'fixture' + ext, relKey: 'fixture' + ext, ext, effectiveExt: ext, languageId: lang, containerLanguageId: null,
    fileHash: null, fileHashAlgo: null, fileSize: Buffer.byteLength(text), tokens: tokenized.tokens, tokenIds: [],
    identifierTokens: [], keywordTokens: [], operatorTokens: [], literalTokens: [], seq: tokenized.seq,
    codeRelations, docmeta, stats: {}, complexity: null, lint: null, preContext: null, postContext: null, minhashSig: [],
    commentFieldTokens: [], dictWords: new Set(), dictConfig: {}, postingsConfig: {}, emitFieldTokens, tokenMode: 'code',
    fileRelations: null, relationsEnabled: false, toolInfo: { tool: 'fixture', version: '1' }, gitMeta: {}, analysisPolicy: null
  });
};
