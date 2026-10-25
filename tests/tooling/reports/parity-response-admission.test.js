import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { createFixtureRetrievalMetadata } from '../../helpers/retrieval-response-fixture.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/reports/parity-response-admission/')[1];
assert.ok(selected, 'the runner selects one independently bounded admission case');
const { dir } = await prepareIsolatedTestCacheDir(`parity-response-${selected}`);
try {
  const queryFile = path.join(dir, 'queries.txt'), out = path.join(dir, 'report.json');
  const payloadFile = path.join(dir, 'payloads.json'), search = path.join(dir, 'explicit-search.mjs');
  const shim = path.join(dir, 'parity-prerequisites.mjs');
  const hit = id => ({ chunkUid: `fixture:${id}`, score: 1 });
  const build = backend => ({ code: [hit(0), hit(1)], prose: [hit('prose')],
    retrieval: createFixtureRetrievalMetadata({ fixtureId: 'parity-response-v1', backend }),
    stats: { elapsedMs: 2, memory: { rss: 1024 * 1024 } } });
  const payloads = Object.fromEntries(['first', 'second'].map(query => [query, { memory: build('memory'), sqlite: build('sqlite') }]));
  for (const query of ['first', 'second']) {
    const row = payloads[query].sqlite;
    if (selected === 'ranking-difference') row.code = [hit(2), hit(1)];
    if (selected === 'explicit-empty') {
      row.code = []; row.prose = []; payloads[query].memory.code = []; payloads[query].memory.prose = [];
    }
    if (selected === 'missing-code') delete row.code;
    if (selected === 'null-code') row.code = null;
    if (selected === 'nonarray-code') row.code = {};
    if (selected === 'failed-status') row.ok = false;
    if (selected === 'malformed-hit') row.code = [null];
    if (selected === 'omitted-hits') row.outputBudget = { truncated: true, omittedHits: 1 };
    if (selected === 'unknown-identity') row.code = [{ score: 1 }];
    if (selected === 'wrong-backend') row.retrieval = createFixtureRetrievalMetadata({ fixtureId: 'parity-response-v1', backend: 'memory' });
    if (selected === 'mixed-queries' && query === 'second') delete row.code;
  }
  await fs.writeFile(queryFile, 'first\nsecond\n');
  await fs.writeFile(payloadFile, JSON.stringify(payloads));
  await fs.writeFile(search, `import fs from 'node:fs';
    const args = process.argv.slice(2), backend = args[args.indexOf('--backend') + 1];
    const payloads = JSON.parse(fs.readFileSync(${JSON.stringify(payloadFile)}, 'utf8'));
    console.log(JSON.stringify(payloads[args[0]][backend]));`);
  // The selected canned adapter tests actual parity/report orchestration, not
  // index/native qualification. Only its expensive artifact prerequisite is inert.
  await fs.writeFile(shim, `import { registerHooks } from 'node:module';
    registerHooks({resolve(specifier,context,next){
      if(context.parentURL?.endsWith('/tests/retrieval/parity/equivalence.test.js') && specifier==='../../../tools/shared/parity-indexes.js')
        return {url:'parity-prerequisite-fixture:owner',shortCircuit:true};
      return next(specifier,context);
    },load(url,context,next){if(url==='parity-prerequisite-fixture:owner')return {format:'module',shortCircuit:true,
      source:'export const ensureParityArtifacts=async()=>({indexByMode:{code:{exists:true},prose:{exists:true}},missingSqliteEntries:[],sqlitePaths:{}});'};
      return next(url,context);}});`);
  const env = applyTestEnv({ syncProcess: false, extraEnv: {
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(shim).href}`.trim()
  } });
  const result = runNode(['tests/retrieval/parity/equivalence.test.js', '--repo', dir, '--queries', queryFile,
    '--search', search, '--top', '2', '--limit', '2', '--no-ann', '--enforce', '--write-report', '--out', out],
  `actual parity response ${selected}`, process.cwd(), env, { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  assert.equal(result.status, selected === 'positive' ? 0 : 1, result.stderr);
  const report = JSON.parse(await fs.readFile(out, 'utf8'));
  assert.equal(report.results.length, 2, 'every requested query remains represented');
  assert.equal(report.summary.coverage.requestedComparisons, 4);
  assert.ok(report.results.every(row => row.caseId && row.memory.admission && row.sqlite.admission));
  if (selected === 'positive') {
    assert.equal(report.summary.coverage.comparableComparisons, 4);
    assert.equal(report.summary.overlapAvg, 1);
    assert.equal(report.summary.coverage.positiveByMode.code, 2);
  } else if (selected === 'ranking-difference') {
    assert.equal(report.results[0].code.overlap, 0.5);
    assert.match(result.stderr, /Parity thresholds failed/);
  } else if (selected === 'explicit-empty') {
    assert.equal(report.summary.coverage.zeroHitComparisons, 4);
    assert.ok(report.results.every(row => row.code.status === 'available' && row.code.zeroHits && row.code.overlap === 1));
    assert.match(result.stderr, /positive-hit witnesses/);
  } else if (selected === 'mixed-queries') {
    assert.equal(report.results[0].code.comparable, true);
    assert.equal(report.results[1].code.status, 'unavailable');
    assert.equal(report.results[1].prose.comparable, true, 'valid sibling observations remain in their denominator');
    assert.equal(report.summary.coverage.comparableComparisons, 3);
    assert.equal(report.summary.coverage.unavailableComparisons, 1);
  } else if (selected === 'unknown-identity') {
    assert.equal(report.results[0].code.comparable, false);
    assert.ok(report.summary.coverage.unknownIdentityCounts.sqlite > 0);
    assert.equal(report.results[0].code.overlap, null);
  } else if (selected === 'wrong-backend') {
    assert.ok(report.results[0].sqlite.admission.reasons.includes('observed-backend-mismatch'));
    assert.equal(report.summary.coverage.comparableComparisons, 0);
  } else if (selected !== 'ranking-difference') {
    assert.equal(report.results[0].code.status, 'unavailable');
    assert.equal(report.results[0].code.overlap, null, 'a missing response cannot mint perfect empty parity');
  }

  // Exercise the actual model-report reducers with the same response cases.
  // Named artifact/corpus/search seams avoid any index or model work.
  const modelPayloads = structuredClone(payloads);
  for (const query of ['first', 'second']) {
    modelPayloads[query].memory.retrieval = createFixtureRetrievalMetadata({ fixtureId: 'model-response-a', backend: 'memory' });
    modelPayloads[query].sqlite.retrieval = createFixtureRetrievalMetadata({ fixtureId: 'model-response-b', backend: selected === 'wrong-backend' ? 'sqlite' : 'memory' });
  }
  const modelFile = path.join(dir, 'model-payloads.json'), modelShim = path.join(dir, 'model-adapter.mjs');
  const modelOut = path.join(dir, 'models.json');
  await fs.writeFile(modelFile, JSON.stringify(modelPayloads));
  const dictSource = `export const DEFAULT_MODEL_ID='fixture-a';
    export const bootstrapRuntime=()=>({repoRoot:${JSON.stringify(dir)},userConfig:{},runtimeEnv:process.env});
    export const resolveToolRoot=()=>${JSON.stringify(process.cwd())};
    export const getCacheRoot=()=>${JSON.stringify(path.join(dir, 'cache'))};
    export const getRepoId=()=> 'fixture-repo';
    export const getModelConfig=()=>({id:'fixture-a',dir:${JSON.stringify(path.join(dir, 'models'))}});
    export const getDictConfig=()=>({dir:${JSON.stringify(path.join(dir, 'dict'))}});
    export const resolveSqlitePaths=()=>({});`;
  const searchSource = `import fs from 'node:fs';
    const payloads=JSON.parse(fs.readFileSync(${JSON.stringify(modelFile)},'utf8'));
    export const runSearchCliWithSubprocessSync=options=>({payload:payloads[options.query][options.env.PAIROFCLEATS_MODEL==='fixture-a'?'memory':'sqlite'],wallMs:3});`;
  const sources = {
    '../shared/dict-utils.js': dictSource,
    '../shared/search-cli-harness.js': searchSource,
    '../../src/shared/artifact-io/chunk-meta-presence.js': 'export const hasChunkMetaArtifactsSync=()=>true;',
    '../../src/retrieval/corpus-comparison.js': 'export const resolveRetrievalCorpusIdentity=async()=>({comparable:true,digest:"explicit-fixture-corpus"});'
  };
  await fs.writeFile(modelShim, `import {registerHooks} from 'node:module';const sources=${JSON.stringify(sources)};
    registerHooks({resolve(specifier,context,next){if(context.parentURL?.endsWith('/tools/reports/compare-models.js')&&Object.hasOwn(sources,specifier))
      return {url:'model-response-fixture:'+encodeURIComponent(specifier),shortCircuit:true};return next(specifier,context);},
    load(url,context,next){if(url.startsWith('model-response-fixture:'))return {format:'module',shortCircuit:true,
      source:sources[decodeURIComponent(url.slice('model-response-fixture:'.length))]};return next(url,context);}});`);
  const models = runNode(['tools/reports/compare-models.js', '--repo', dir, '--models', 'fixture-a,fixture-b',
    '--cache-root', path.join(dir, 'model-caches'),
    '--queries', queryFile, '--no-ann', '--mode', 'both', '--backend', 'memory', '--json', '--out', modelOut],
  `actual model response ${selected}`, process.cwd(), { ...env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(modelShim).href}`.trim()
  }, { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  const invalidResponse = ['missing-code', 'null-code', 'nonarray-code', 'failed-status', 'malformed-hit', 'omitted-hits', 'mixed-queries'].includes(selected);
  assert.equal(models.status, invalidResponse ? 1 : 0, models.stderr);
  const modelReport = JSON.parse(await fs.readFile(modelOut, 'utf8'));
  assert.equal(modelReport.results.length, 2);
  const codeSummary = modelReport.summary.comparisons['fixture-b'].code;
  assert.equal(codeSummary.requestedQueries, 2);
  if (selected === 'positive') {
    assert.equal(codeSummary.comparableQueries, 2);
    assert.equal(modelReport.qualification.state, 'qualified');
  } else if (selected === 'mixed-queries') {
    assert.equal(codeSummary.comparableQueries, 1);
    assert.equal(codeSummary.unavailableQueries, 1);
    assert.equal(modelReport.summary.comparisons['fixture-b'].prose.comparableQueries, 2);
    assert.equal(modelReport.results[1].runs['fixture-b'].codeCount, null);
  } else if (!['ranking-difference', 'explicit-empty'].includes(selected)) {
    assert.equal(codeSummary.comparableQueries, 0);
    assert.equal(codeSummary.overlapAvg, null, 'all unavailable model comparisons retain unknown means');
    assert.equal(codeSummary.scoreDeltaAvg, null);
    assert.equal(modelReport.qualification.state, 'unqualified');
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log(`actual parity response admission ${selected} test passed`);
