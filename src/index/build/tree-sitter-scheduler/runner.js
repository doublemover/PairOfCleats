import { throwIfAborted } from '../../../shared/abort.js';
import { buildTreeSitterSchedulerPlan } from './plan.js';
import { executeTreeSitterSchedulerPlan } from './executor.js';
import { createTreeSitterSchedulerLookup } from './lookup.js';

export const runTreeSitterScheduler = async ({
  mode,
  runtime,
  entries,
  outDir,
  fileTextCache = null,
  abortSignal = null,
  log = null
}) => {
  throwIfAborted(abortSignal);
  const planResult = await buildTreeSitterSchedulerPlan({
    mode,
    runtime,
    entries,
    outDir,
    fileTextCache,
    abortSignal,
    log
  });
  if (!planResult) return null;

  const execResult = await executeTreeSitterSchedulerPlan({
    mode,
    runtime,
    groups: planResult.groups,
    outDir,
    abortSignal,
    log
  });

  const lookup = createTreeSitterSchedulerLookup({
    outDir,
    index: execResult?.index || new Map(),
    log
  });

  return {
    ...lookup,
    plan: planResult.plan,
    schedulerStats: execResult?.stats || null
  };
};

