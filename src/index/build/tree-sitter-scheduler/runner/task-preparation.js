import {
  assertTreeSitterScheduledGroupsContract,
  assertTreeSitterSchedulerTaskContracts
} from '../contracts.js';
import {
  buildWarmPoolTasks,
  resolveExecConcurrency,
  resolveExecutionOrder,
  resolveSchedulerTaskTimeoutMs
} from './task-scheduler.js';

export const prepareTreeSitterSchedulerTasks = ({
  planResult,
  schedulerConfig = {}
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
  const execConcurrency = resolveExecConcurrency({
    schedulerConfig,
    grammarCount: executionOrder.length
  });
  const plannedTasks = buildWarmPoolTasks({
    executionOrder,
    groupMetaByGrammarKey,
    schedulerConfig,
    execConcurrency
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
    plannedTasks
  };
};
