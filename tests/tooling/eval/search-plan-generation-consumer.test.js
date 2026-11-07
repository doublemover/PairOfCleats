import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { captureEvaluationDatasetCases } from '../../../tools/eval/dataset-admission.js';
import { resolveEvaluationCohorts } from '../../../tools/eval/cohorts.js';
import { createEvaluationDepthPlan } from '../../../tools/eval/depth-plan.js';
import { captureLiveEvaluationInput, assertQualifiedEvaluationComparison } from '../../../tools/shared/retrieval-execution-evidence.js';
import { captureEvaluationSearchPlan, assertEvaluationSearchPlan } from '../../../tools/eval/search-plan.js';
import { bakeoffGenerationObservation, matchEvaluatedBakeoffGeneration } from '../../../tools/bench/embeddings/evaluation-identity.js';

const { dir } = await prepareIsolatedTestCacheDir('eval-generation-consumer'), repo = path.join(dir, 'repo');
await fs.mkdir(repo);
await fs.writeFile(path.join(repo, 'main.js'), 'function policyWitness() { return 1; }\n');
const config = createFastIndexingTestConfig({ threads: 1, sqlite: { use: false },
  indexing: { workerPool: { maxWorkers: 1 }, embeddings: { enabled: false, mode: 'off' } } });
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', testConfig: config });
const datasetFile = path.join(dir, 'eval.json');
const dataset = [{ query: 'policyWitness', mode: 'code', relevant: [{ file: 'main.js' }] }];
await fs.writeFile(datasetFile, JSON.stringify(dataset));
let ordinal = 0;
const preflight = async rows => {
  const captured = captureEvaluationDatasetCases(rows).map(row => ({ ...row,
    selection: resolveEvaluationCohorts(row.mode, [...row.silver, ...row.gold]) }));
  const { cases, identity } = captureLiveEvaluationInput(captured, createEvaluationDepthPlan(5, 'exact'), 0);
  const plan = await captureEvaluationSearchPlan({ repoRoot: repo, cases, evaluationInput: identity, topN: 5, backend: 'memory', annFlag: false });
  return { evaluationInput: identity, evaluationSearchPlan: plan.receipt };
};
const execute = async () => {
  const oldArgs = process.argv, log = console.log, lines = [];
  try {
    process.argv = [process.execPath, 'eval-run', '--repo', repo, '--dataset', datasetFile,
      '--backend', 'memory', '--no-ann', '--top', '5', '--match-mode', 'exact'];
    console.log = value => lines.push(value);
    await import(new URL(`../../../tools/eval/run.js?actual-policy=${ordinal++}`, import.meta.url));
    assert.equal(lines.length, 1); return JSON.parse(lines[0]);
  } finally { process.argv = oldArgs; console.log = log; }
};
try {
  await buildIndex(repo, { mode: 'code', stage: 'stage2', threads: 1, sqlite: false, 'scm-provider': 'none', progress: 'off' });
  const admitted = await preflight(dataset), evaluated = await execute();
  assertQualifiedEvaluationComparison(evaluated);
  assertEvaluationSearchPlan(evaluated, admitted);
  assert.equal(evaluated.summary.mrr, 1);
  const indexA = getIndexDir(repo, 'code', loadUserConfig(repo));
  const repoCache = path.dirname(path.dirname(path.dirname(indexA)));
  const generationA = await bakeoffGenerationObservation(repoCache);
  assert.equal(matchEvaluatedBakeoffGeneration(evaluated, generationA), generationA.identity);
  const retained = JSON.parse(JSON.stringify(evaluated));
  assertEvaluationSearchPlan(retained, await preflight(dataset));
  assert.equal(matchEvaluatedBakeoffGeneration(retained, generationA), generationA.identity);

  // A query-only ranking change leaves indexed bytes/generation untouched.
  await withTemporaryEnv({ PAIROFCLEATS_TEST_CONFIG: JSON.stringify({ ...config,
    search: { fieldWeights: { name: 9 } } }) }, async () => {
    const changed = await preflight(dataset);
    assert.equal((await bakeoffGenerationObservation(repoCache)).identity, generationA.identity);
    assert.notEqual(changed.evaluationSearchPlan.key, admitted.evaluationSearchPlan.key);
    assert.throws(() => assertEvaluationSearchPlan(retained, changed), { code: 'ERR_BAKEOFF_EVALUATION_PLAN' });
    const current = await execute(); assertQualifiedEvaluationComparison(current);
    assertEvaluationSearchPlan(current, changed);
  });
  const mutated = [{ ...dataset[0], relevant: [{ file: 'absent.js' }] }];
  await fs.writeFile(datasetFile, JSON.stringify(mutated));
  const differentInput = await execute();
  assert.equal(differentInput.summary.mrr, 0);
  assert.throws(() => assertEvaluationSearchPlan(differentInput, admitted), { code: 'ERR_BAKEOFF_EVALUATION_PLAN' });
  await fs.writeFile(datasetFile, JSON.stringify(dataset));

  // Actual later publication may confirm A only when it still selects A.
  await fs.appendFile(path.join(repo, 'main.js'), '\nfunction laterPublication() { return 2; }\n');
  await buildIndex(repo, { mode: 'code', stage: 'stage2', threads: 1, sqlite: false, 'scm-provider': 'none', progress: 'off' });
  const generationB = await bakeoffGenerationObservation(repoCache);
  assert.notEqual(generationB.identity, generationA.identity);
  assert.equal(matchEvaluatedBakeoffGeneration(retained, generationB), null, 'A scores cannot receive the later B identity');
  assert.equal(matchEvaluatedBakeoffGeneration({ executionEvidence: { status: 'qualified', consistency: 'stable', receipts: [] } }, generationB), null);
  const legacy = { ...retained }; delete legacy.evaluationSearchPlan;
  assert.throws(() => assertEvaluationSearchPlan(legacy, admitted), { code: 'ERR_BAKEOFF_EVALUATION_PLAN' });
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Actual evaluator consumes the canonical policy capture; retained scores bind evaluated input, policy and generation rather than later current state.');
