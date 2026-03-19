import fs from 'node:fs/promises';
import { coerceAbortSignal } from '../../../shared/abort.js';
import { writeJsonObjectFile, writeJsonLinesFile } from '../../../shared/json-stream.js';
import { resolveTreeSitterSchedulerPaths } from './paths.js';
import { createTreeSitterFileVersionSignature } from './file-signature.js';
import { shouldSkipTreeSitterPlanningForPath } from './policy.js';
import { loadTreeSitterSchedulerAdaptiveProfile } from './adaptive-profile.js';
import { estimateSegmentParseCost } from './plan/cost-model.js';
import { createSkipLogger, resolvePlannerIoConcurrency } from './plan/diagnostics.js';
import {
  applyTreeSitterGrammarPreflight,
  discoverTreeSitterSchedulerGroups,
  resolveEntryPaths
} from './plan/discovery.js';
import {
  MIN_ESTIMATED_PARSE_COST,
  summarizeBucketMetrics,
  summarizeGrammarJobs
} from './plan/metrics.js';
import {
  resolveAdaptiveBucketTargetCost,
  resolveAdaptiveBucketTargetJobs,
  resolveAdaptiveWaveTargetCost,
  resolveAdaptiveWaveTargetJobs
} from './plan/policy-normalization.js';
import { assignPathAwareBuckets } from './plan/candidate-ranking.js';
import {
  assembleGrammarGroups,
  shardGrammarGroup,
  splitGrammarBucketIntoWaves
} from './plan/assembly.js';
import {
  buildContinuousWaveExecutionOrder,
  buildLaneDiagnostics,
  buildPlanGroupArtifacts
} from './plan/execution.js';
import { assertTreeSitterScheduledGroupsContract, assertTreeSitterScheduledJobContract } from './contracts.js';

export const buildTreeSitterSchedulerPlan = async ({
  mode,
  runtime,
  entries,
  outDir,
  fileTextCache = null,
  abortSignal = null,
  log = null
}) => {
  const effectiveAbortSignal = coerceAbortSignal(abortSignal);
  if (mode !== 'code') return null;
  const treeSitterConfig = runtime?.languageOptions?.treeSitter || null;
  if (!treeSitterConfig || treeSitterConfig.enabled === false) return null;
  const strict = treeSitterConfig?.strict === true;
  const skipOnParseError = runtime?.languageOptions?.skipOnParseError === true;
  const skipLogger = createSkipLogger({ treeSitterConfig, log });
  const recordSkip = (reason, message) => skipLogger.record(reason, message);

  const paths = resolveTreeSitterSchedulerPaths(outDir);
  await fs.mkdir(paths.baseDir, { recursive: true });
  await fs.mkdir(paths.jobsDir, { recursive: true });

  const plannerIoConcurrency = resolvePlannerIoConcurrency(
    treeSitterConfig,
    Array.isArray(entries) ? entries.length : 0
  );
  const discovered = await discoverTreeSitterSchedulerGroups({
    runtime,
    entries,
    fileTextCache,
    abortSignal: effectiveAbortSignal,
    treeSitterConfig,
    mode,
    strict,
    skipOnParseError,
    plannerIoConcurrency,
    recordSkip,
    shouldSkipTreeSitterPlanningForPath,
    createTreeSitterFileVersionSignature
  });
  const { groups, requiredNative } = applyTreeSitterGrammarPreflight({
    groups: discovered.groups,
    requiredNativeLanguages: discovered.requiredNativeLanguages,
    strict,
    log
  });

  const { entriesByGrammarKey: observedRowsPerSecByGrammar } = await loadTreeSitterSchedulerAdaptiveProfile({
    runtime,
    treeSitterConfig,
    log
  });
  const schedulerConfig = treeSitterConfig?.scheduler || {};
  const groupList = assembleGrammarGroups({
    groupsByGrammarKey: groups,
    schedulerConfig,
    observedRowsPerSecByGrammar
  });
  assertTreeSitterScheduledGroupsContract(groupList, { phase: 'scheduler-plan:groups' });
  const executionOrder = buildContinuousWaveExecutionOrder(groupList);
  const laneDiagnostics = buildLaneDiagnostics(groupList);
  const { finalGrammarKeys, groupMeta, totalJobs } = buildPlanGroupArtifacts(groupList);

  const plan = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    mode,
    repoRoot: runtime.root,
    repoCacheRoot: runtime?.repoCacheRoot || null,
    outDir,
    jobs: totalJobs,
    grammarKeys: finalGrammarKeys,
    executionOrder,
    groupMeta,
    laneDiagnostics,
    requiredNativeLanguages: requiredNative,
    treeSitterConfig
  };

  await writeJsonObjectFile(paths.planPath, { fields: plan, atomic: true });
  for (const group of groupList) {
    const jobPath = paths.jobPathForGrammarKey(group.grammarKey);
    await writeJsonLinesFile(jobPath, group.jobs, { atomic: true, compression: null });
  }

  skipLogger.flush();
  return { plan, groups: groupList, paths };
};

export const treeSitterSchedulerPlannerInternals = Object.freeze({
  estimateSegmentParseCost,
  summarizeGrammarJobs,
  resolveAdaptiveBucketTargetJobs,
  resolveAdaptiveWaveTargetJobs,
  resolveAdaptiveBucketTargetCost,
  resolveAdaptiveWaveTargetCost,
  assignPathAwareBuckets,
  summarizeBucketMetrics,
  shardGrammarGroup,
  splitGrammarBucketIntoWaves,
  buildContinuousWaveExecutionOrder,
  buildLaneDiagnostics,
  resolvePlannerIoConcurrency,
  createSkipLogger,
  resolveEntryPaths,
  MIN_ESTIMATED_PARSE_COST,
  assertTreeSitterScheduledJobContract
});
