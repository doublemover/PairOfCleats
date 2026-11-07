import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { initGitRepo } from '../../helpers/git-fixture.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

const root = process.cwd(), { dir } = await prepareIsolatedTestCacheDir('parity-partial-ranks');
const repo = path.join(dir, 'repo'), queryFile = path.join(dir, 'queries.txt'), reportPath = path.join(dir, 'parity.json');
await fs.mkdir(path.join(repo, 'src'), { recursive: true }); initGitRepo(repo);
await fs.writeFile(path.join(repo, 'src/answer.js'), 'export function alphaBetaGamma() { return 42; }\n');
await fs.writeFile(path.join(repo, 'README.md'), 'alpha beta gamma parity fixture\n');
await fs.writeFile(queryFile, 'alpha\nbeta\ngamma\n');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub',
  testConfig: { threads: 1, indexing: { scm: { provider: 'none' }, typeInference: false,
    typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } } }, extraEnv: {
    PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo])
  } });
// Publish actual tiny indexes through the existing in-process core owner, avoiding
// a second full CLI bootstrap before the report's deliberately selected adapter.
const signal = AbortSignal.timeout(10000);
await buildIndex(repo, { mode: 'all', modes: ['code', 'prose'], stage: 'stage1',
  'stub-embeddings': true, threads: 1, abortSignal: signal });
signal.throwIfAborted();
for (const mode of ['code', 'prose']) await runSqliteBuild(repo, { env, mode });
const result = await spawnSubprocess(process.execPath, [path.join(root, 'tests/retrieval/parity/equivalence.test.js'),
  '--repo', repo, '--search', path.join(root, 'tests/fixtures/retrieval/partial-ranks-search.js'),
  '--queries', queryFile, '--top', '10', '--limit', '3', '--write-report', '--out', reportPath,
  '--no-ann', '--enforce', '--min-overlap', '0', '--min-overlap-single', '0', '--min-rank-corr', '0'], {
  cwd: root, env, timeoutMs: 20000, maxOutputBytes: 256 * 1024, rejectOnNonZeroExit: false
});
await fs.writeFile(path.join(dir, 'command-receipt.json'), JSON.stringify(result, null, 2));
const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
console.log(JSON.stringify({ exitCode: result.exitCode, summary: report.summary,
  correlations: report.results.map(row => row.code.rankCorr), dir }));
assert.deepEqual(report.results.map(row => row.code.rankCorr), [1, -1, null]);
assert.equal(report.summary.rankCorrAvg, 0, 'undefined correlations cannot alter the actual parity average');
assert.equal(report.summary.coverage.unavailableComparisons, 0);
assert.equal(report.summary.coverage.positiveByMode.prose, 3, 'explicit prose controls qualify its independent required cohort');
assert.equal(result.exitCode, 0, result.stderr);
assert.match(result.stdout, /Rank corr avg: 0\.000/);
assert.doesNotMatch(result.stderr, /Parity thresholds failed/);
