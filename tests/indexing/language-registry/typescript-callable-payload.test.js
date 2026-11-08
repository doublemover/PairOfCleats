import assert from 'node:assert/strict';
import { buildLanguageContext } from '../../../src/index/language-registry.js';
import { buildChunkEnrichment } from '../../../src/index/build/file-processor/process-chunks/enrichment.js';
import { buildChunkPayload } from '../../../src/index/build/file-processor/assemble.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const text = 'export function apply(callback: () => string) {}\nclass Example { @tag(extra) empty() {} }';
const noop = () => {};
for (const parser of ['typescript', 'babel']) {
  const options = { typescript: { parser }, treeSitter: { enabled: false } };
  const { lang, context } = await buildLanguageContext({ text, ext: '.ts', relPath: 'input.ts', mode: 'code', options });
  const chunk = context.tsChunks.find(chunk => chunk.name === 'apply');
  assert.ok(chunk?.meta.callableParameters, 'registered route retains successful parser authority');
  const before = { ...context.typeScriptSyntaxContext };
  const enrichment = buildChunkEnrichment({ chunkMode: 'code', text, chunkText: text.slice(chunk.start, chunk.end), chunk, chunkIndex: 0,
    activeLang: lang, activeContext: context, languageOptions: options, fileRelations: null, callIndex: null, relationsEnabled: false,
    fileStructural: null, chunkLineCount: 1, chunkLanguageId: 'typescript', resolvedTypeInferenceEnabled: false,
    resolvedRiskAnalysisEnabled: false, riskConfig: {}, astDataflowEnabled: false, controlFlowEnabled: false,
    addSettingMetric: noop, addEnrichDuration: noop, updateCrashStage: noop, failFile: (...args) => assert.fail(JSON.stringify(args)),
    diagnostics: [], startLine: 1, endLine: 1, totalLines: 2 });
  assert.ok(!enrichment.skip);
  assert.equal(enrichment.docmeta.paramTypes.callback, '() => string');
  assert.equal(enrichment.docmeta.callableParameters, chunk.meta.callableParameters);
  const payload = buildChunkPayload({ chunk: { ...chunk, startLine: 1, endLine: 1, chunkUid: `fixture-${parser}`, spanIndex: 0 },
    rel: 'input.ts', relKey: 'input.ts', ext: '.ts', effectiveExt: '.ts', languageId: 'typescript', fileHash: null,
    fileSize: text.length, tokens: [], tokenIds: [], identifierTokens: [], keywordTokens: [], operatorTokens: [], literalTokens: [],
    seq: [], codeRelations: {}, docmeta: enrichment.docmeta, stats: {}, complexity: null, lint: null, preContext: null, postContext: null,
    minhashSig: [], commentFieldTokens: [], dictWords: new Set(), dictConfig: {}, postingsConfig: {}, emitFieldTokens: false,
    tokenMode: 'code', fileRelations: null, relationsEnabled: false, toolInfo: { tool: 'test', version: '0.0.0' }, gitMeta: {}, analysisPolicy: null });
  const stored = JSON.parse(JSON.stringify(payload));
  assert.equal(stored.docmeta.paramTypes.callback, '() => string');
  assert.equal(stored.docmeta.callableParameters.parser, parser === 'typescript' ? 'typescript-compiler' : 'typescript-babel');
  assert.equal(stored.docmeta.callableParameters.slots[0].type.text, '() => string');
  assert.deepEqual(context.typeScriptSyntaxContext, before, 'enrichment and payload assembly reuse the admitted syntax');
}
console.log('registered TypeScript callable enrichment/payload test passed');
