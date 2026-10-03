import { isSubprocessCrashExit } from './crash-utils.js';

export const TREE_SITTER_SCHEDULER_FAILURE_CLASSES = Object.freeze({
  parserTimeout: 'parser_timeout',
  parserCrash: 'parser_crash',
  parserShapeRejection: 'parser_shape_rejection',
  stalePlan: 'stale_plan',
  contractViolation: 'scheduler_contract_violation',
  schedulerFailure: 'scheduler_failure'
});

const CONTRACT_MESSAGE_RE = /missing segmentuid|missing executionorder|scheduler task|scheduler plan missing|contract/i;
const STALE_PLAN_RE = /stale plan/i;
const SHAPE_REJECTION_RE = /no tree-sitter chunks produced|invalid job|invalid segment range|missing fields/i;

export const classifyTreeSitterSchedulerFailure = ({
  error,
  crashEvent = null
} = {}) => {
  const crashEventFailureClass = typeof crashEvent?.failureClass === 'string' ? crashEvent.failureClass.trim() : '';
  const crashEventFallbackConsequence = typeof crashEvent?.fallbackConsequence === 'string'
    ? crashEvent.fallbackConsequence.trim()
    : '';
  if (crashEventFailureClass) {
    return {
      failureClass: crashEventFailureClass,
      fallbackConsequence: crashEventFallbackConsequence || 'degrade_virtual_paths'
    };
  }
  const stage = String(crashEvent?.stage || error?.stage || '').trim();
  const message = String(crashEvent?.message || error?.message || '').trim();
  const code = String(crashEvent?.code || error?.code || '').trim().toUpperCase();
  const exitCode = Number(error?.result?.exitCode);
  const signal = typeof error?.result?.signal === 'string' ? error.result.signal : null;
  if (code === 'SUBPROCESS_TIMEOUT' || stage.includes('timeout') || message.toLowerCase().includes('timed out')) {
    return {
      failureClass: TREE_SITTER_SCHEDULER_FAILURE_CLASSES.parserTimeout,
      fallbackConsequence: 'degrade_virtual_paths'
    };
  }
  if (STALE_PLAN_RE.test(message) || stage.includes('stale-plan')) {
    return {
      failureClass: TREE_SITTER_SCHEDULER_FAILURE_CLASSES.stalePlan,
      fallbackConsequence: 'fail_closed'
    };
  }
  if (CONTRACT_MESSAGE_RE.test(message) || code === 'ERR_TREE_SITTER_SCHEDULER_CONTRACT') {
    return {
      failureClass: TREE_SITTER_SCHEDULER_FAILURE_CLASSES.contractViolation,
      fallbackConsequence: 'fail_closed'
    };
  }
  if (SHAPE_REJECTION_RE.test(message) || stage === 'scheduler-build-tree-sitter-chunks') {
    return {
      failureClass: TREE_SITTER_SCHEDULER_FAILURE_CLASSES.parserShapeRejection,
      fallbackConsequence: 'degrade_virtual_paths'
    };
  }
  if (
    crashEvent?.reason === 'test-injected'
    || isSubprocessCrashExit({ exitCode, signal })
    || typeof signal === 'string'
  ) {
    return {
      failureClass: TREE_SITTER_SCHEDULER_FAILURE_CLASSES.parserCrash,
      fallbackConsequence: 'degrade_virtual_paths'
    };
  }
  return {
    failureClass: TREE_SITTER_SCHEDULER_FAILURE_CLASSES.schedulerFailure,
    fallbackConsequence: 'degrade_virtual_paths'
  };
};
