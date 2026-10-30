import { buildCoreSearchInvocation } from '../../src/integrations/core/search-invocation.js';
import { parseSearchArgs } from '../../src/retrieval/cli-args.js';
import { normalizeSearchOptions } from '../../src/retrieval/cli/normalize-options.js';
import { captureEffectiveSearchPlan, resolveObservedSearchSystemIdentity, INTERNAL_SEARCH_POLICY } from '../../src/retrieval/cli/effective-plan.js';
import { getAutoPolicy, getDictConfig, getMetricsDir, getModelConfig, loadUserConfig } from '../shared/dict-utils.js';
import { getEnvConfig } from '../../src/shared/env/runtime.js';
import { resolveEmbeddingIntent } from '../../src/shared/embedding-intent.js';
import { semanticHash } from '../../src/index/semantic/identity.js';
import { getRepoRoot } from '../../src/shared/repo-paths.js';

/** Use the same invocation/parser/normalization/capability owners as core search.
 * Capture configuration once; each actual request consumes its original token.
 * The serializable receipt describes that plan, never grants execution rights. */
export const captureEvaluationSearchPlan = async ({ repoRoot, cases, evaluationInput, topN, backend, annFlag }) => {
  const rootDir = getRepoRoot(repoRoot);
  const userConfig = loadUserConfig(rootDir), policy = await getAutoPolicy(rootDir, userConfig);
  const modelConfig = getModelConfig(rootDir, userConfig), dictConfig = getDictConfig(rootDir, userConfig);
  const metricsDir = getMetricsDir(rootDir, userConfig), requests = new Map(), systems = {};
  for (const entry of cases) {
    const args = ['--json', '--repo', repoRoot, '-n', String(topN)];
    if (entry.selection.requestMode) args.push('--mode', entry.selection.requestMode);
    if (backend && backend !== 'auto') args.push('--backend', backend);
    if (annFlag === true) args.push('--ann');
    if (annFlag === false) args.push('--no-ann');
    const params = { args, query: entry.query, emitOutput: false, exitOnError: false };
    const { rawArgs } = buildCoreSearchInvocation(repoRoot, params), argv = parseSearchArgs(rawArgs);
    const normalized = normalizeSearchOptions({ argv, rawArgs, rootDir, userConfig, metricsDir, policy });
    const { useStubEmbeddings } = resolveEmbeddingIntent({ argv, embeddingsConfig: userConfig.indexing?.embeddings,
      envConfig: getEnvConfig(), execution: 'query' });
    const data = { rootDir, rawArgs, normalized, userConfig, policy,
      modelConfig: { ...modelConfig, id: argv.model || modelConfig.id }, dictConfig, useStubEmbeddings };
    const system = resolveObservedSearchSystemIdentity(data), context = entry.selection.modes.join(',');
    if (systems[context] && systems[context] !== system) throw new Error('Evaluation query policy changed while capturing its plan.');
    systems[context] = system;
    requests.set(entry.caseId, { ...params, [INTERNAL_SEARCH_POLICY]: captureEffectiveSearchPlan(data) });
  }
  const definition = { schemaVersion: 1, inputKey: evaluationInput.key, systems };
  const receipt = Object.freeze({ ...definition, key: semanticHash('evaluation-query-plan.v1', definition) });
  return Object.freeze({ receipt, request(caseId) {
    const request = requests.get(caseId);
    if (!request) throw new Error('Evaluation case is outside its captured query plan.');
    return { ...request, args: request.args.slice() };
  } });
};

export const assertEvaluationSearchPlan = (report, expected = report) => {
  const actual = report?.evaluationSearchPlan, planned = expected?.evaluationSearchPlan;
  const intact = plan => plan?.schemaVersion === 1 && typeof plan.inputKey === 'string'
    && plan.systems && typeof plan.systems === 'object' && !Array.isArray(plan.systems)
    && Object.keys(plan.systems).length > 0 && Object.keys(plan.systems).length <= 16
    && Object.values(plan.systems).every(value => /^esp1-[a-f0-9]{64}$/.test(value))
    && plan.key === semanticHash('evaluation-query-plan.v1', { schemaVersion: 1, inputKey: plan.inputKey, systems: plan.systems });
  if (!intact(actual) || !intact(planned) || actual.key !== planned.key
    || actual.inputKey !== report?.evaluationInput?.key || planned.inputKey !== expected?.evaluationInput?.key) {
    throw Object.assign(new Error('Evaluated inputs or effective query policy differ from the admitted bakeoff plan.'), { code: 'ERR_BAKEOFF_EVALUATION_PLAN' });
  }
  for (const row of report.executionEvidence?.receipts || []) {
    if (actual.systems[row.receipt.modes.join(',')] !== row.receipt.effectiveSystemIdentity) {
      throw Object.assign(new Error('Evaluation executed outside its captured query-policy plan.'), { code: 'ERR_BAKEOFF_EVALUATION_PLAN' });
    }
  }
  return actual.key;
};
