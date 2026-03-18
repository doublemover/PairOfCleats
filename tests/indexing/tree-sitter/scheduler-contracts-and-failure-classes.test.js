#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildVfsVirtualPath } from '../../../src/index/tooling/vfs.js';
import {
  assertTreeSitterScheduledGroupsContract,
  assertTreeSitterScheduledJobContract,
  assertTreeSitterSchedulerTaskContracts,
  buildTreeSitterPlannerFailureSnapshot
} from '../../../src/index/build/tree-sitter-scheduler/contracts.js';
import {
  classifyTreeSitterSchedulerFailure,
  TREE_SITTER_SCHEDULER_FAILURE_CLASSES
} from '../../../src/index/build/tree-sitter-scheduler/runner/failure-classification.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const validJob = {
  schemaVersion: '1.0.0',
  grammarKey: 'native:javascript',
  runtimeKind: 'native',
  languageId: 'javascript',
  containerPath: 'src/example.js',
  containerExt: '.js',
  effectiveExt: '.js',
  segmentStart: 0,
  segmentEnd: 24,
  virtualPath: buildVfsVirtualPath({
    containerPath: 'src/example.js',
    segmentUid: 'seg:base',
    effectiveExt: '.js'
  }),
  fileVersionSignature: {
    hash: 'abc123',
    size: 24,
    mtimeMs: 123456
  },
  segment: {
    segmentId: 'segment-1',
    segmentUid: 'seg:base',
    type: 'code',
    languageId: 'javascript',
    start: 0,
    end: 24,
    ext: '.js',
    meta: {}
  }
};

const identity = assertTreeSitterScheduledJobContract(validJob, { phase: 'test:valid-job' });
assert.equal(identity.segmentUid, 'seg:base', 'expected stable segment uid on planned job');

const validGroups = [{
  grammarKey: 'native:javascript',
  baseGrammarKey: 'native:javascript',
  bucketKey: 'native:javascript',
  wave: 1,
  shard: 1,
  jobs: [validJob]
}];
assert.equal(
  assertTreeSitterScheduledGroupsContract(validGroups, { phase: 'test:groups' }),
  true,
  'expected valid scheduled groups to satisfy the contract'
);

const validTasks = [{
  taskId: 'native:javascript#pool1',
  baseGrammarKey: 'native:javascript',
  laneIndex: 1,
  laneCount: 1,
  timeoutMs: 30000,
  grammarKeys: ['native:javascript']
}];
assert.equal(
  assertTreeSitterSchedulerTaskContracts(validTasks, {
    executionOrder: ['native:javascript'],
    groupByGrammarKey: new Map([['native:javascript', validGroups[0]]]),
    phase: 'test:tasks'
  }),
  true,
  'expected valid scheduler tasks to satisfy the contract'
);

assert.throws(
  () => assertTreeSitterScheduledJobContract({
    ...validJob,
    virtualPath: buildVfsVirtualPath({ containerPath: 'src/example.js', effectiveExt: '.js' }),
    segment: {
      ...validJob.segment,
      segmentUid: null
    }
  }, { phase: 'test:missing-segmentuid' }),
  /ERR_TREE_SITTER_SCHEDULER_CONTRACT|missing segmentUid/i,
  'expected scheduler contract to reject planned jobs without stable identity'
);

const snapshot = buildTreeSitterPlannerFailureSnapshot({
  plan: {
    mode: 'code',
    jobs: 1,
    executionOrder: ['native:javascript'],
    requiredNativeLanguages: ['javascript']
  },
  groups: validGroups,
  tasks: validTasks,
  failureSummary: {
    parserCrashSignatures: 1,
    failedGrammarKeys: ['native:javascript'],
    degradedVirtualPaths: [validJob.virtualPath],
    failureClasses: {
      [TREE_SITTER_SCHEDULER_FAILURE_CLASSES.parserCrash]: 1
    }
  }
});
assert.equal(snapshot.mode, 'code', 'expected planner snapshot mode');
assert.equal(snapshot.scheduledJobs.length, 1, 'expected one scheduled job in snapshot');
assert.equal(snapshot.scheduledJobs[0].laneIndex, 1, 'expected lane assignment in snapshot');
assert.equal(snapshot.scheduledJobs[0].timeoutMs, 30000, 'expected timeout budget in snapshot');
assert.deepEqual(
  snapshot.failureSummary.failureClasses,
  { [TREE_SITTER_SCHEDULER_FAILURE_CLASSES.parserCrash]: 1 },
  'expected failure classes in snapshot'
);

assert.deepEqual(
  classifyTreeSitterSchedulerFailure({
    error: { code: 'SUBPROCESS_TIMEOUT', message: 'timed out' }
  }),
  {
    failureClass: TREE_SITTER_SCHEDULER_FAILURE_CLASSES.parserTimeout,
    fallbackConsequence: 'degrade_virtual_paths'
  },
  'expected timeout classification'
);
assert.deepEqual(
  classifyTreeSitterSchedulerFailure({
    error: { stage: 'scheduler-stale-plan', message: 'stale plan for src/example.js' }
  }),
  {
    failureClass: TREE_SITTER_SCHEDULER_FAILURE_CLASSES.stalePlan,
    fallbackConsequence: 'fail_closed'
  },
  'expected stale-plan classification'
);
assert.deepEqual(
  classifyTreeSitterSchedulerFailure({
    error: { stage: 'scheduler-build-tree-sitter-chunks', message: 'No tree-sitter chunks produced' }
  }),
  {
    failureClass: TREE_SITTER_SCHEDULER_FAILURE_CLASSES.parserShapeRejection,
    fallbackConsequence: 'degrade_virtual_paths'
  },
  'expected parser shape rejection classification'
);
assert.deepEqual(
  classifyTreeSitterSchedulerFailure({
    error: {
      code: 'ERR_TREE_SITTER_SCHEDULER_CONTRACT',
      message: '[tree-sitter:schedule] scheduler-runner:tasks: missing segmentUid'
    }
  }),
  {
    failureClass: TREE_SITTER_SCHEDULER_FAILURE_CLASSES.contractViolation,
    fallbackConsequence: 'fail_closed'
  },
  'expected scheduler contract violation classification'
);
assert.deepEqual(
  classifyTreeSitterSchedulerFailure({
    error: { result: { exitCode: 0xC0000005, signal: null } },
    crashEvent: {
      failureClass: TREE_SITTER_SCHEDULER_FAILURE_CLASSES.parserCrash,
      fallbackConsequence: 'degrade_virtual_paths'
    }
  }),
  {
    failureClass: TREE_SITTER_SCHEDULER_FAILURE_CLASSES.parserCrash,
    fallbackConsequence: 'degrade_virtual_paths'
  },
  'expected explicit crash event classification to win'
);

console.log('tree-sitter scheduler contracts and failure classes ok');
