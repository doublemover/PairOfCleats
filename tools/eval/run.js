#!/usr/bin/env node
import { EVAL_OPTIONS } from '../shared/operator-cli-options.js';
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { createToolDisplay } from '../shared/cli-display.js';
import { search as coreSearch } from '../../src/integrations/core/index.js';
import { createSqliteDbCache } from '../../src/retrieval/sqlite-cache.js';
import { resolveEvaluationCohorts, selectEvaluationCohort, judgmentsForCohort } from './cohorts.js';
import { matchExpected, resolveMatchMode } from './match.js';
import { collectExpectedJudgments, computeMRR, computeNDCG, computeRecallAtK } from './metrics.js';
import { evaluateDatasetVectorReplay } from './vector-oracle.js';
import { evaluateDatasetFusionReplay } from './fusion-replay.js';
import { evaluateDatasetShadowRouting } from './shadow-routing.js';
import { evaluateDatasetTaskSpans } from './task-spans.js';
import { runEvaluationResourceScope } from './resource-scope.js';
import { captureEvaluationDatasetCases } from './dataset-admission.js';
import { createEvaluationDepthPlan, evaluationDepthCoverage } from './depth-plan.js';
import { buildEvaluationSummary } from './summary.js';
import { captureEvaluationSearchPlan } from './search-plan.js';
import { captureLiveEvaluationInput, createRetrievalEvidenceRegistry } from '../shared/retrieval-execution-evidence.js';

const argv = createCli({
  scriptName: 'eval-run',
  options: EVAL_OPTIONS,
  aliases: { n: 'top' }
}).parse();

const display = createToolDisplay({
  argv,
  stream: process.stderr,
  displayOptions: { json: true }
});
const fail = (message, code = 1) => {
  display.error(message);
  display.close();
  process.exit(code);
};

const root = process.cwd();
const repoRoot = argv.repo ? path.resolve(argv.repo) : root;
const datasetPath = argv.dataset
  ? path.resolve(argv.dataset)
  : path.join(root, 'tests', 'fixtures', 'sample', 'eval.json');
const backend = argv.backend ? String(argv.backend) : 'auto';
const topN = Math.max(1, parseInt(argv.top, 10) || 10);
const limit = Math.max(0, parseInt(argv.limit, 10) || 0);
const annFlag = typeof argv.ann === 'boolean' ? argv.ann : null;
const matchMode = (() => {
  try {
    return resolveMatchMode(argv['match-mode']);
  } catch (err) {
    fail(err?.message || 'Invalid match mode.', 2);
  }
})();
const evaluationPlan = createEvaluationDepthPlan(topN, matchMode);
const ks = evaluationPlan.cutoffs;

const loadDataset = () => {
  const raw = fs.readFileSync(datasetPath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw Object.assign(new Error('Evaluation dataset must be an array of cases.'), { code: 'ERR_EVAL_DATASET' });
  return data;
};

const isMatch = (hit, expected) => matchExpected(hit, expected, matchMode);

const runSearch = async (request) => {
  const payload = await coreSearch(repoRoot, {
    ...request,
    indexCache: evalCaches.indexCache,
    sqliteCache: evalCaches.sqliteCache
  });
  return payload;
};

const evalCaches = {
  indexCache: new Map(),
  sqliteCache: createSqliteDbCache()
};

const output = await runEvaluationResourceScope({ sqliteCache: evalCaches.sqliteCache, display }, async () => {
  const allCases = loadDataset();
  const cases = limit > 0 ? allCases.slice(0, limit) : allCases;
  if (!cases.length) {
    throw Object.assign(new Error(`No eval cases found at ${datasetPath}`), { code: 'ERR_EVAL_DATASET' });
  }

  const capturedCases = captureEvaluationDatasetCases(cases).map(admitted => ({ ...admitted,
    selection: resolveEvaluationCohorts(admitted.mode, [...admitted.silver, ...admitted.gold]) }));
  const { cases: admittedCases, identity: evaluationInput } = captureLiveEvaluationInput(capturedCases, evaluationPlan, limit);
  const searchPlan = await captureEvaluationSearchPlan({ repoRoot, cases: admittedCases, evaluationInput, topN, backend, annFlag });
  const evidence = createRetrievalEvidenceRegistry();
  const results = [];
  const queryTask = display.task('Queries', { total: cases.length, stage: 'queries' });
  let processedCases = 0;
  for (const { entry, query, silver, gold, selection, caseId } of admittedCases) {
    const payload = await runSearch(searchPlan.request(caseId));
    const execution = evidence.observe(payload, selection.modes);
    const cohorts = selection.modes.map(cohortMode => {
      const hits = selectEvaluationCohort(payload, cohortMode);
      const depthCoverage = evaluationDepthCoverage(hits, evaluationPlan);
      const scopedSilver = judgmentsForCohort(silver, cohortMode), scopedGold = judgmentsForCohort(gold, cohortMode);
      const silverJudgments = collectExpectedJudgments(hits, scopedSilver, isMatch, { mode: cohortMode });
      const goldJudgments = collectExpectedJudgments(hits, scopedGold, isMatch, { mode: cohortMode });
      const metric = ({ ranks, totalRelevant }) => totalRelevant ? {
        recallAtK: Object.fromEntries(ks.map(k => [k, computeRecallAtK(ranks, totalRelevant, k)])),
        mrr: computeMRR(ranks), ndcgAtK: Object.fromEntries(ks.map(k => [k, computeNDCG(ranks, totalRelevant, k)]))
      } : null;
      return { mode: cohortMode, depthCoverage,
        totals: { relevant: silverJudgments.totalRelevant, gold: goldJudgments.totalRelevant, hits: hits.length },
        metrics: metric(silverJudgments), goldMetrics: metric(goldJudgments) };
    });
    const macroMetrics = key => {
      const observed = cohorts.map(row => row[key]).filter(Boolean);
      if (!observed.length) return null;
      const average = getter => observed.reduce((sum, row) => sum + getter(row), 0) / observed.length;
      return { recallAtK: Object.fromEntries(ks.map(k => [k, average(row => row.recallAtK[k])])),
        ndcgAtK: Object.fromEntries(ks.map(k => [k, average(row => row.ndcgAtK[k])])), mrr: average(row => row.mrr) };
    };
    const vectorOracleReplay = await evaluateDatasetVectorReplay({ entry, query, topN });
    results.push({ query, caseId, execution, mode: selection.requestMode || 'default', cohorts,
      ...(vectorOracleReplay ? { vectorOracleReplay } : {}),
      totals: { relevant: cohorts.reduce((sum, row) => sum + row.totals.relevant, 0),
        gold: cohorts.reduce((sum, row) => sum + row.totals.gold, 0), hits: cohorts.reduce((sum, row) => sum + row.totals.hits, 0) },
      metrics: macroMetrics('metrics'), goldMetrics: macroMetrics('goldMetrics') });
    processedCases += 1;
    queryTask.set(processedCases, cases.length);
  }

  const summary = buildEvaluationSummary(results, evaluationPlan);

  const report = {
    schemaVersion: 3,
    kind: 'live-judged-evaluation',
    generatedAt: new Date().toISOString(),
    repo: repoRoot,
    dataset: datasetPath,
    matchMode,
    evaluationInput,
    evaluationSearchPlan: searchPlan.receipt,
    executionEvidence: evidence.snapshot(),
    limit,
    backend,
    topN,
    ann: annFlag,
    ks,
    evaluationPlan,
    relevancePolicy: evaluationPlan.policy,
    vectorEvaluationPolicy: 'independent-original-and-stored.v1;saved-stage-replay-separated',
    summary,
    results
  };
  const fusionReplay = await evaluateDatasetFusionReplay({ cases });
  if (fusionReplay) report.fusionReplay = fusionReplay;
  const shadowRouting = evaluateDatasetShadowRouting({ cases });
  if (shadowRouting) report.shadowRouting = shadowRouting;
  const taskSpanReplay = await evaluateDatasetTaskSpans({ cases });
  if (taskSpanReplay) report.taskSpanReplay = taskSpanReplay;
  return report;
});

if (argv.out) {
  fs.writeFileSync(path.resolve(argv.out), JSON.stringify(output, null, 2));
}

const payload = argv.pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output);
console.log(payload);
