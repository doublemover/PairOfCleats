import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { search } from '../../../src/integrations/core/search.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { captureBenchmarkQueryResults } from '../../../tools/bench/language/query-results.js';
import { collectBenchmarkArtifactReport, qualifyBenchmarkArtifactGeneration } from '../../../tools/bench/language/artifact-report.js';
import { createRetrievalEvidenceRegistry } from '../../../tools/shared/retrieval-execution-evidence.js';
import { runNode } from '../../helpers/run-node.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('perf/bench/selected-cohort-generation-consumer/')[1];
assert.ok(['results', 'publication'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`bench-cohort-${selected}`);
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
const queries = path.join(dir, 'queries.json');
await fs.writeFile(queries, JSON.stringify(['commentuniquewitness', 'absentuniquewitness']));
await fs.writeFile(path.join(repo, 'main.js'), '/** commentuniquewitness documents the function. */\nexport function plainFunction() { return 1; }\n');
await fs.writeFile(path.join(repo, 'README.md'), '# Guide\nOrdinary prose description.\n');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off',
  testConfig: createFastIndexingTestConfig({ threads: 1, sqlite: { use: false },
    indexing: { workerPool: { maxWorkers: 1 }, embeddings: { enabled: false, mode: 'off' } } }) });
let hooks;
try {
  await buildIndex(repo, { mode: 'all', stage: 'stage2', threads: 1, sqlite: false,
    'scm-provider': 'none', progress: 'off' });
  const request = async query => search(repo, { query, args: ['--backend', 'memory', '--no-ann', '--json', '--stats'] });
  const positive = await request('commentuniquewitness'), empty = await request('absentuniquewitness');
  assert.equal(positive.code.length, 0); assert.equal(positive.prose.length, 0);
  assert.ok(positive.extractedProse.some(hit => hit.file === 'main.js'));
  assert.equal(captureBenchmarkQueryResults(positive).nonempty, true);
  assert.equal(captureBenchmarkQueryResults(empty).totalHits, 0);
  assert.throws(() => captureBenchmarkQueryResults({ code: [], prose: [] }), /cohort|missing|unavailable/i);
  const registry = createRetrievalEvidenceRegistry();
  registry.observe(positive, ['code', 'prose', 'extracted-prose']);
  registry.observe(empty, ['code', 'prose', 'extracted-prose']);
  const measured = registry.snapshot();
  const before = collectBenchmarkArtifactReport({ repoRoot: repo }).report;
  assert.equal(qualifyBenchmarkArtifactGeneration(before, [measured]).state, 'qualified');
  const entry = new URL('./run.test.js', import.meta.url).href;
  if (selected === 'publication') {
    // Actual query results are captured before a second real publication. The
    // benchmark's artifact collection boundary then sees the later generation.
    const oldIndex = getIndexDir(repo, 'code', loadUserConfig(repo));
    await fs.appendFile(path.join(repo, 'main.js'), '\nfunction secondPublication() { return 2; }\n');
    await buildIndex(repo, { mode: 'code', stage: 'stage2', threads: 1, sqlite: false,
      'scm-provider': 'none', progress: 'off' });
    assert.notEqual(getIndexDir(repo, 'code', loadUserConfig(repo)), oldIndex);
    const after = collectBenchmarkArtifactReport({ repoRoot: repo }).report;
    const refused = qualifyBenchmarkArtifactGeneration(after, [measured]);
    assert.equal(refused.state, 'incompatible'); assert.equal(refused.mode, 'code');
    // Run the real report reducer with the measured original payloads. Only its
    // query execution transport is inert; collection remains the actual child.
    globalThis.benchmarkCapturedPayloads = [positive, empty];
    hooks = registerHooks({ resolve(specifier, context, next) {
      if (context.parentURL?.split('?')[0] === entry && specifier === './query-execution.js') return { url: 'captured-bench:execution', shortCircuit: true };
      return next(specifier, context);
    }, load(url, context, next) {
      if (url === 'captured-bench:execution') return { format: 'module', shortCircuit: true,
        source: `export const executeBenchQueryPlan = async ({tasks,runTask}) => {
          const payloads=globalThis.benchmarkCapturedPayloads.slice();
          for(const task of tasks)await runTask(task,{run:async()=>payloads.shift()});
          return {scope:'inert-transport-of-actual-earlier-search-payloads'};
        };` };
      return next(url, context);
    } });
    const previous = process.argv, log = console.log; const lines = [];
    try {
      process.argv = [process.execPath, entry, '--repo', repo, '--queries', queries, '--backend', 'memory',
        '--no-ann', '--json', '--quiet', '--query-concurrency', '1', '--top', '5'];
      console.log = value => lines.push(value);
      await assert.rejects(import(`${entry}?captured-publication`), { code: 'ERR_BENCH_ARTIFACT_GENERATION' });
    } finally { process.argv = previous; console.log = log; }
    assert.equal(lines.length, 1);
    const report = JSON.parse(lines[0]);
    assert.equal(report.status, 'failed-required-artifact-phase');
    assert.equal(report.artifacts, null); assert.ok(report.currentAfterRun.artifacts);
    assert.equal(report.summary.hitRate.memory, 0.5);
    assert.equal(report.summary.resultCountsByMode.memory['extracted-prose'].nonempty, 1);
    assert.equal(report.summary.queryExecutionEvidence.memory.observations, 2);
  } else {
    // Actual benchmark entry, worker, searches and artifact-report child.
    const child = runNode(['tests/perf/bench/run.test.js', '--repo', repo, '--queries', queries,
      '--backend', 'memory', '--no-ann', '--json', '--quiet', '--query-concurrency', '1', '--top', '5'],
    'selected extracted-prose benchmark', process.cwd(), process.env, { stdio: 'pipe', allowFailure: true, timeoutMs: 30000 });
    assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(child.stdout);
    assert.equal(report.status, 'completed'); assert.equal(report.summary.hitRate.memory, 0.5);
    assert.equal(report.artifactReportAdmission.generationJoin.state, 'qualified');
    assert.equal(report.summary.resultCountsByMode.memory.code.hits, 0);
    assert.equal(report.summary.resultCountsByMode.memory.prose.hits, 0);
    assert.equal(report.summary.resultCountsByMode.memory['extracted-prose'].nonempty, 1);
    assert.equal(report.summary.queryOutcomeEvidence.cohorts.length, 3);
    const extracted = report.summary.queryOutcomeEvidence.cohorts.find(row => row.mode === 'extracted-prose');
    assert.equal(extracted.searches, 2); assert.equal(extracted.nonempty, 1); assert.equal(extracted.empty, 1);
    assert.equal(extracted.unknownExpected, 2, 'plain query text does not become a positive relevance judgment');
  }
} finally {
  hooks?.deregister(); delete globalThis.benchmarkCapturedPayloads;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Actual selected-cohort searches retain measured generation and partial benchmark work: ' + selected);
