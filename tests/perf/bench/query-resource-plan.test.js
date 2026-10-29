import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { resolveAdaptiveQueryWorkerCount } from './query-runtime.js';
import { executeBenchQueryPlan } from './query-execution.js';

const GiB = 1024 ** 3, MiB = 1024 ** 2;
const sizing = { totalSystemMemoryBytes: 8 * GiB, codeArtifactBytes: 400 * MiB, proseArtifactBytes: 0,
  sqliteCodeBytes: 4 * GiB, sqliteProseBytes: 0 };
const staged = await resolveAdaptiveQueryWorkerCount({ ...sizing, requestedConcurrency: 4, backends: ['memory', 'sqlite'] });
assert.equal(staged.stages.length, 2, '1000 MiB memory workers and3072 MiB SQLite cannot each borrow the full3276 MiB allowance');
assert.deepEqual(staged.backendConcurrency, { memory: 3, sqlite: 1 });
assert.equal(staged.effectiveConcurrency, 3);
assert.ok(staged.stages.every(stage => stage.estimatedConcurrentBytes <= staged.budgetBytes));
const oversize = await resolveAdaptiveQueryWorkerCount({ ...sizing, requestedConcurrency: 4, backends: ['sqlite'], sqliteCodeBytes: 8 * GiB });
assert.equal(oversize.status, 'unsupported'); assert.deepEqual(oversize.oversizeClasses, ['sqlite']);
let created = 0;
await assert.rejects(executeBenchQueryPlan({ plan: oversize, tasks: [], createPool() { created++; } }), { code: 'ERR_BENCH_QUERY_PLAN_UNSUPPORTED' });
assert.equal(created, 0, 'unsupported plans cannot launch a worker');

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('perf/bench/query-resource-plan/')[1];
const cases = { 'default-one': [null, 1, ['memory', 'sqlite']], 'default-four': [null, 4, ['memory', 'sqlite']],
  'all-four': ['all', 4, ['memory', 'sqlite', 'sqlite-fts']], 'aliases-one': ['memory,sqlite-fts,fts', 1, ['memory', 'sqlite-fts', 'fts']],
  'memory-four': ['memory', 4, ['memory']], 'fts-four': ['fts', 4, ['fts']] };
assert.ok(Object.hasOwn(cases, selected));
const [backend, concurrency, expected] = cases[selected];
const { dir } = await prepareIsolatedTestCacheDir(`query-resource-plan-${selected}`);
try {
  const queries = path.join(dir, 'queries.txt'), trace = path.join(dir, 'caller.json'), probe = path.join(dir, 'caller.mjs');
  await fs.writeFile(queries, 'first\nsecond\n');
  const bench = new URL('./run.test.js', import.meta.url).href;
  const runtime = new URL('./query-runtime.js', import.meta.url).href;
  const execution = new URL('./query-execution.js', import.meta.url).href;
  const queue = pathToFileURL(path.join(process.cwd(), 'node_modules', 'p-queue', 'dist', 'index.js')).href;
  // Invoke the actual benchmark entry/reducers with explicitly named inert
  // artifact/search adapters. Resource planning and stage execution remain real.
  const sources = {
    '../../../tools/shared/dict-utils.js': `export const loadUserConfig=()=>({});
      export const getIndexDir=()=>${JSON.stringify(dir)};
      export const getRuntimeConfig=()=>({maxOldSpaceMb:1024});
      export const resolveRuntimeEnv=(config,env)=>({...env});
      export const resolveSqlitePaths=()=>({codePath:'fixture-code.db',prosePath:'fixture-prose.db'});`,
    '../../../tools/bench/language/artifact-report.js': 'export const collectBenchmarkArtifactReport=()=>({report:{repo:{root:'+JSON.stringify(dir)+'},throughput:{},corruption:{ok:true,issues:[]}},receipt:{state:"explicit-query-plan-fixture"}});',
    '../../../src/shared/artifact-io/chunk-meta-presence.js': 'export const hasChunkMetaArtifactsSync=()=>true;',
    '../../../tools/bench/language/sqlite-mode-status.js': 'export const resolveBenchSqliteModeStatus=()=>({dbExists:true,zeroState:false});',
    'node:child_process': "export const spawnSync=()=>({status:0,stdout:'{}'});",
    './query-runtime.js': `import {resolveAdaptiveQueryWorkerCount as actual} from ${JSON.stringify(runtime)};
      export const resolveAdaptiveQueryWorkerCount=options=>{globalThis.queryPlanCalls.push(options.backends);return actual({...options,runtimeRoot:'',
        totalSystemMemoryBytes:8*1024**3,codeArtifactBytes:0,proseArtifactBytes:0,sqliteCodeBytes:0,sqliteProseBytes:0});};`,
    './query-execution.js': `import {executeBenchQueryPlan as actual} from ${JSON.stringify(execution)};
      import PQueue from ${JSON.stringify(queue)};let pid=50000;
      export const executeBenchQueryPlan=options=>actual({...options,processTreeSampler:null,createPool(config){
        globalThis.queryPoolCalls.push(config.sizeByBackend);
        const queues=Object.fromEntries(Object.entries(config.sizeByBackend).map(([key,size])=>[key,new PQueue({concurrency:size})]));
        return {run(args,meta){return queues[meta.backend==='memory'?'memory':'sqlite'].add(async()=>{
          const id=++pid;config.onEvent({type:'process-start',pid:id});config.onEvent({type:'run-start',pid:id,meta});
          await new Promise(resolve=>setImmediate(resolve));config.onEvent({type:'run-complete',pid:id,meta});config.onEvent({type:'process-close',pid:id});
          return {code:[{chunkUid:'fixture:hit',score:1}],prose:[],stats:{elapsedMs:1,memory:{rss:1024}}};
        });},async close(){await Promise.all(Object.values(queues).map(queue=>queue.onIdle()));}};
      }});`
  };
  await fs.writeFile(probe, `import fs from 'node:fs';import {registerHooks} from 'node:module';
    const sources=${JSON.stringify(sources)},bench=${JSON.stringify(bench)};
    globalThis.queryPlanCalls=[];globalThis.queryPoolCalls=[];
    registerHooks({resolve(specifier,context,next){if(context.parentURL===bench&&Object.hasOwn(sources,specifier))
      return {url:'query-plan-caller-fixture:'+encodeURIComponent(specifier),shortCircuit:true};return next(specifier,context);},
      load(url,context,next){if(url.startsWith('query-plan-caller-fixture:'))return {format:'module',shortCircuit:true,
        source:sources[decodeURIComponent(url.slice('query-plan-caller-fixture:'.length))]};return next(url,context);}});
    await import(bench);fs.writeFileSync(${JSON.stringify(trace)},JSON.stringify({plans:globalThis.queryPlanCalls,pools:globalThis.queryPoolCalls}));`);
  const args = [probe, '--repo', dir, '--queries', queries, '--query-concurrency', String(concurrency),
    '--limit', '2', '--no-ann', '--stub-embeddings', '--quiet', '--json'];
  if (backend) args.push('--backend', backend);
  const result = runNode(args, `actual aggregate query plan ${selected}`, process.cwd(), applyTestEnv({ syncProcess: false }),
    { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
  const receipt = JSON.parse(await fs.readFile(trace, 'utf8')), report = JSON.parse(result.stdout), summary = report.summary;
  assert.deepEqual(receipt.plans, [expected], 'the actual caller must admit all pools in exactly one resource plan');
  assert.equal(summary.queryWorkerPlan.concurrencyScope, 'global');
  assert.ok(summary.queryConcurrency <= concurrency);
  assert.ok(summary.queryWorkerObservation.peakRunningQueries <= concurrency);
  assert.equal(summary.queryWorkerObservation.completed, expected.length * 2);
  assert.deepEqual(summary.queryCoverage.executedSearchesByBackend, Object.fromEntries(expected.map(backend => [backend, 2])));
  assert.equal(summary.queryWorkerPlan.backendConcurrency.sqlite ?? 1, 1);
  if (concurrency === 1 && expected.includes('memory') && expected.length > 1) assert.equal(receipt.pools.length, 2);
  assert.equal(summary.queryWorkerObservation.processTreeRssPeakBytes, null, 'unobserved descendant RSS cannot become a measured zero');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log(`aggregate benchmark caller ${selected} preserves every query/backend under one global plan`);
