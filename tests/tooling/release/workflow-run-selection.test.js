#!/usr/bin/env node
import assert from 'node:assert/strict';
import { selectLatestWorkflowRunGateState } from '../../../tools/release/workflow-run-selection.js';

const successFromLatest = selectLatestWorkflowRunGateState([
  {
    databaseId: 100,
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-03-25T10:00:00Z',
    updatedAt: '2026-03-25T10:05:00Z'
  },
  {
    databaseId: 101,
    status: 'completed',
    conclusion: 'failure',
    createdAt: '2026-03-25T11:00:00Z',
    updatedAt: '2026-03-25T11:05:00Z'
  }
]);
assert.equal(successFromLatest.kind, 'failed', 'expected latest failed run to beat older success');
assert.equal(successFromLatest.text, 'failed:101:failure');

const pendingFromLatest = selectLatestWorkflowRunGateState([
  {
    databaseId: 200,
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-03-25T10:00:00Z',
    updatedAt: '2026-03-25T10:05:00Z'
  },
  {
    databaseId: 201,
    status: 'in_progress',
    conclusion: null,
    createdAt: '2026-03-25T11:00:00Z',
    updatedAt: '2026-03-25T11:01:00Z'
  }
]);
assert.equal(pendingFromLatest.kind, 'pending', 'expected latest active run to block older success');
assert.equal(pendingFromLatest.text, 'pending:201:in_progress');

const successWhenLatestIsSuccess = selectLatestWorkflowRunGateState([
  {
    databaseId: 300,
    status: 'completed',
    conclusion: 'failure',
    createdAt: '2026-03-25T10:00:00Z',
    updatedAt: '2026-03-25T10:05:00Z'
  },
  {
    databaseId: 301,
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-03-25T11:00:00Z',
    updatedAt: '2026-03-25T11:06:00Z'
  }
]);
assert.equal(successWhenLatestIsSuccess.kind, 'success');
assert.equal(successWhenLatestIsSuccess.text, 'success:301');

const rerunOrdering = selectLatestWorkflowRunGateState([
  {
    databaseId: 400,
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-03-25T10:00:00Z',
    updatedAt: '2026-03-25T10:05:00Z'
  },
  {
    databaseId: 400,
    status: 'completed',
    conclusion: 'failure',
    createdAt: '2026-03-25T10:00:00Z',
    updatedAt: '2026-03-25T10:07:00Z'
  }
]);
assert.equal(rerunOrdering.kind, 'failed', 'expected later rerun update time to win');
assert.equal(rerunOrdering.text, 'failed:400:failure');

const missing = selectLatestWorkflowRunGateState([]);
assert.equal(missing.kind, 'missing');
assert.equal(missing.text, 'missing');

console.log('workflow run selection test passed');
