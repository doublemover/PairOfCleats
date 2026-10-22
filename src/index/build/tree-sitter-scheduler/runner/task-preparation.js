import {
  assertTreeSitterScheduledGroupsContract,
  assertTreeSitterSchedulerTaskContracts
} from '../contracts.js';
import {
  buildWarmPoolTasks,
  resolveExecConcurrency,
  resolveParserExecutionBudget,
  resolveExecutionOrder,
  resolveSchedulerTaskTimeoutMs
} from './task-scheduler.js';

export const prepareTreeSitterSchedulerTasks = ({
  planResult,
  schedulerConfig = {},
  runtime = null
} = {}) => {
  assertTreeSitterScheduledGroupsContract(planResult?.groups, { phase: 'scheduler-runner:groups' });
  const executionOrder = resolveExecutionOrder(planResult?.plan);
  const grammarKeys = Array.from(new Set(executionOrder));
  const groupMetaByGrammarKey = planResult?.plan?.groupMeta && typeof planResult.plan.groupMeta === 'object'
    ? planResult.plan.groupMeta
    : {};
  const groupByGrammarKey = new Map();
  for (const group of planResult?.groups || []) {
    if (!group?.grammarKey) continue;
    groupByGrammarKey.set(group.grammarKey, group);
  }
  const executionBudget = resolveParserExecutionBudget(runtime);
  const execConcurrency = resolveExecConcurrency({
    schedulerConfig,
    grammarCount: executionOrder.length,
    executionBudget
  });
  const plannedTasks = buildWarmPoolTasks({
    executionOrder,
    groupMetaByGrammarKey,
    schedulerConfig,
    execConcurrency,
    executionBudget,
    warmLaneHistory: planResult?.plan?.warmLaneHistory || {},
    warmLaneProfileIdentity: planResult?.plan?.warmLaneProfileIdentity || null
  }).map((task) => ({
    ...task,
    timeoutMs: resolveSchedulerTaskTimeoutMs({
      schedulerConfig,
      task,
      groupByGrammarKey
    })
  }));
  assertTreeSitterSchedulerTaskContracts(plannedTasks, {
    executionOrder,
    groupByGrammarKey,
    phase: 'scheduler-runner:tasks'
  });
  return {
    executionOrder,
    grammarKeys,
    groupMetaByGrammarKey,
    groupByGrammarKey,
    execConcurrency,
    executionBudget,
    plannedTasks
  };
};
