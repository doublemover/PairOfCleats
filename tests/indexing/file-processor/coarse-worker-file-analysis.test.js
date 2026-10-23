import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { processFileCpuWithWorker } from '../../../src/index/build/file-processor/coarse-worker.js';
import { executeFileAnalysis } from '../../../src/index/build/workers/file-analysis-task.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createTokenizationBuffers, createTokenizationContext, tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { fileAnalysisAdmissionBytes, FILE_ANALYSIS_MAX_OUTPUT_BYTES, projectFileAnalysisInput,
  decodeFileAnalysisInput, decodeFileAnalysisResult } from '../../../src/index/build/workers/file-analysis-contract.js';
import { createScmFileProcessorContext } from './scm-file-processor-test-helper.js';
import { normalizeRiskConfig } from '../../../src/index/risk.js';

// AUTHORED, execution deferred until the shared wave is frozen.
const CASES = {
  js: { ext: '.js', text: '/** Add a value. */\nexport function add(x) { if (x) return x + 1; return 0; }\n' },
  jsx: { ext: '.jsx', text: 'export function View({name}) { return <section><span>{name}</span></section>; }\n' },
  ts: { ext: '.ts', text: 'export interface Box { value: string }\nexport function read(box: Box): string { return box.value; }\n' },
  tsx: { ext: '.tsx', text: 'interface Props { value: string }\nexport const View = ({value}: Props) => <span>{value}</span>;\n' },
  malformed: { ext: '.js', text: 'export function broken( { return unknown. }\n' },
  replay: { ext: '.js', text: 'export function read(req) { const secret = req.body; return secret; }\n' },
  authority: { ext: '.js', text: 'export const value = 1;\n' }
};
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const names = CASES[selected] ? [selected] : Object.keys(CASES);
const resources = { dictWords: new Set(), codeDictWords: new Set(), codeDictWordsByLanguage: new Map(), codeDictLanguages: null,
  backend: 'worker', tokenize: (row, context) => tokenizeChunkText({ ...row, context, buffers: createTokenizationBuffers() }) };
const riskConfig = normalizeRiskConfig({ enabled: true, rules: { includeDefaults: false, rules: {
  sources: [{ name: 'request', patterns: ['req\\.body'] }], sinks: [], sanitizers: []
} } }, { rootDir: process.cwd() });

for (const name of names) {
  const sample = CASES[name];
  const relKey = `src/coarse-worker-fixture-${name}${sample.ext}`;
  const make = overrides => createScmFileProcessorContext({ abs: path.join(process.cwd(), relKey), ext: sample.ext,
    rel: relKey, relKey, text: sample.text, fileStat: { size: Buffer.byteLength(sample.text) },
    fileHash: createHash('sha1').update(sample.text).digest('hex'), fileHashAlgo: 'sha1', scmProviderImpl: null,
    scmProvider: null, embeddingEnabled: false, relationsEnabled: true, lintEnabled: true, complexityEnabled: true,
    typeInferenceEnabled: true, riskAnalysisEnabled: true, riskConfig, astDataflowEnabled: true, controlFlowEnabled: true,
    tokenContext: createTokenizationContext({ dictWords: resources.dictWords, dictConfig: {}, postingsConfig: {}, treeSitter: { enabled: false } }),
    lexicalCheckpointDependencies: { parse: 'coarse-parse', lexical: 'coarse-lexical' },
    analysisPolicy: { metadata: { enabled: true }, risk: { enabled: true }, typeInference: { local: { enabled: true } } },
    languageOptions: { treeSitter: { enabled: false }, pythonAst: { enabled: false }, skipOnParseError: true,
      javascript: { parser: 'babel' }, typescript: { parser: 'typescript' }, astDataflowEnabled: true, controlFlowEnabled: true },
    tokenizationStats: { chunks: 0, tokens: 0, seq: 0 }, ...overrides });
  const scheduler = createBuildScheduler({ cpuTokens: 1, maxInFlightBytes: fileAnalysisAdmissionBytes(Buffer.byteLength(sample.text)) });
  let tasks = 0;
  const pool = { config: { enabled: true }, shouldUseForFile: () => true, analyzeFile: async payload => {
    tasks++;
    assert.equal(scheduler.stats().tokens.cpu.used, 1, 'coarse compute keeps one valid parent CPU reservation');
    assert.ok(payload.body instanceof Uint8Array);
    assert.equal(Object.hasOwn(payload, 'jsAst'), false, 'no AST/context crosses the transport');
    return executeFileAnalysis(payload, resources);
  } };
  const run = context => scheduler.schedule('file', { cpu: 1, bytes: fileAnalysisAdmissionBytes(Buffer.byteLength(sample.text)) }, () =>
    processFileCpuWithWorker(context));
  try {
    const expected = await processFileCpu(make());
    const context = make({ workerPool: pool });
    const actual = await run(context);
    assert.deepEqual(actual, expected, `${name}: chunks, syntax facts, relations, risk/type/lint and checkpoint projection`);
    assert.equal(tasks, 1, `${name}: real consumer uses the coarse task contract`);
    assert.equal(context.tokenizationStats.coarseAnalysis.completed, 1);
    if (name === 'replay' && expected.lexicalCheckpoint) {
      const warm = make({ workerPool: pool, cachedLexicalCheckpoint: expected.lexicalCheckpoint,
        cachedStageBundle: { stageRefresh: { parse: false }, parseCheckpoint: expected.parseCheckpoint } });
      assert.deepEqual(await run(warm), expected, 'coarse worker preserves canonical parse/lexical replay meaning');
      assert.ok(warm.tokenizationStats.lexicalCheckpoint.productHits > 0);
    }
    if (name === 'authority') {
      const prepared = projectFileAnalysisInput(make());
      assert.ok(prepared.payload);
      assert.throws(() => decodeFileAnalysisInput({ ...prepared.payload, languageId: 'python' }), { code: 'ERR_FILE_ANALYSIS_PROTOCOL' });
      const result = await executeFileAnalysis(prepared.payload, resources);
      assert.throws(() => decodeFileAnalysisResult(prepared.payload, { ...result, outputBytes: FILE_ANALYSIS_MAX_OUTPUT_BYTES + 1 }),
        { code: 'ERR_FILE_ANALYSIS_PROTOCOL' });
      const stopped = new AbortController(); stopped.abort();
      await assert.rejects(run(make({ workerPool: pool, signal: stopped.signal })), { name: 'AbortError' });
      const primary = Object.assign(new Error('worker lifetime unconfirmed'), { code: 'ERR_WORKER_POOL_CLEANUP_UNCONFIRMED' });
      await assert.rejects(run(make({ workerPool: { ...pool, analyzeFile: async () => { throw primary; } } })), error => error === primary);
      const unsupported = projectFileAnalysisInput(make({ semantic: { enabled: true } }));
      assert.equal(unsupported.reason, 'compiler-session-owner');
      assert.equal(projectFileAnalysisInput(make({ languageOptions: { treeSitter: { enabled: false }, customParser: () => {} } })).reason,
        'unsupported-language-option');
      const rejected = make({ workerPool: { ...pool, analyzeFile: async payload => {
        const receipt = await executeFileAnalysis(payload, resources); receipt.identity = 'mismatched'; return receipt;
      } } });
      assert.deepEqual(await run(rejected), expected, 'completed rejected projection returns to existing inline authority');
      assert.equal(rejected.tokenizationStats.coarseAnalysis.declined['rejected-result'], 1);
    }
  } finally { await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 }); }
}
console.log('coarse file analysis exercises existing CPU consumers, immutable transport and explicit fallback authority');
