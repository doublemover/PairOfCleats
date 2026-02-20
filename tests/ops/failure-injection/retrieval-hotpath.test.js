#!/usr/bin/env node
import { applyTestEnv, syncProcessEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import {
  OP_FAILURE_CLASSES,
  OP_FAILURE_CODES,
  classifyOperationalFailure,
  resetOperationalFailureInjectionState,
  runWithOperationalFailurePolicy
} from '../../../src/shared/ops-failure-injection.js';

const prevEnv = {
  PAIROFCLEATS_TESTING: process.env.PAIROFCLEATS_TESTING,
  PAIROFCLEATS_TEST_CONFIG: process.env.PAIROFCLEATS_TEST_CONFIG
};

const setFailureConfig = (config) => {
  applyTestEnv({ testConfig: config });
  resetOperationalFailureInjectionState();
};

try {
  const logs = [];
  setFailureConfig({
    ops: {
      failureInjection: {
        enabled: true,
        retriableRetries: 1,
        rules: [
          {
            target: 'retrieval.hotpath',
            failureClass: OP_FAILURE_CLASSES.RETRIABLE,
            failCount: 1,
            message: 'simulated transient retrieval failure'
          }
        ]
      }
    }
  });
  const retriableResult = await runWithOperationalFailurePolicy({
    target: 'retrieval.hotpath',
    operation: 'test-retrieval-hotpath',
    execute: async () => 'ok',
    log: (message) => logs.push(String(message))
  });
  assert.equal(retriableResult.value, 'ok', 'expected retriable injection to recover and return value');
  assert.equal(retriableResult.attempts, 2, 'expected one retry for retriable injected failure');
  assert.equal(retriableResult.recovered, true, 'expected retriable path to report recovery');
  assert.ok(
    logs.some((line) => line.includes('classification=retriable')),
    'expected retry log to include retriable classification'
  );

  let nonRetriableError = null;
  setFailureConfig({
    ops: {
      failureInjection: {
        enabled: true,
        retriableRetries: 3,
        rules: [
          {
            target: 'indexing.hotpath',
            failureClass: OP_FAILURE_CLASSES.NON_RETRIABLE,
            failCount: 1,
            message: 'simulated fatal indexing failure'
          }
        ]
      }
    }
  });
  try {
    await runWithOperationalFailurePolicy({
      target: 'indexing.hotpath',
      operation: 'test-indexing-hotpath',
      execute: async () => 'should-not-complete'
    });
  } catch (err) {
    nonRetriableError = err;
  }
  assert.ok(nonRetriableError, 'expected non-retriable injection to throw');
  assert.equal(
    nonRetriableError.code,
    OP_FAILURE_CODES.INJECTED_NON_RETRIABLE,
    'expected injected non-retriable code'
  );
  assert.equal(
    nonRetriableError.opFailureClassification,
    OP_FAILURE_CLASSES.NON_RETRIABLE,
    'expected non-retriable classification on thrown error'
  );
  assert.equal(nonRetriableError.opFailureRetriable, false, 'expected non-retriable error to disable retry');

  let noRetryError = null;
  setFailureConfig({
    ops: {
      failureInjection: {
        enabled: true,
        retriableRetries: 0,
        rules: [
          {
            target: 'retrieval.hotpath',
            failureClass: OP_FAILURE_CLASSES.RETRIABLE,
            failCount: 1,
            message: 'single-attempt retriable failure'
          }
        ]
      }
    }
  });
  try {
    await runWithOperationalFailurePolicy({
      target: 'retrieval.hotpath',
      operation: 'test-no-retry-budget',
      execute: async () => 'not-expected'
    });
  } catch (err) {
    noRetryError = err;
  }
  assert.ok(noRetryError, 'expected retriable injection to throw when retry budget is zero');
  assert.equal(
    noRetryError.code,
    OP_FAILURE_CODES.INJECTED_RETRIABLE,
    'expected injected retriable code when retry budget is zero'
  );
  assert.equal(
    noRetryError.opFailureClassification,
    OP_FAILURE_CLASSES.RETRIABLE,
    'expected retriable classification to be preserved on no-retry failures'
  );

  const timeoutClassification = classifyOperationalFailure({ code: 'ETIMEDOUT' });
  assert.equal(
    timeoutClassification.classification,
    OP_FAILURE_CLASSES.RETRIABLE,
    'expected ETIMEDOUT to classify as retriable'
  );
  const explicitClassification = classifyOperationalFailure({
    code: 'INTERNAL',
    opFailureClass: OP_FAILURE_CLASSES.NON_RETRIABLE
  });
  assert.equal(
    explicitClassification.classification,
    OP_FAILURE_CLASSES.NON_RETRIABLE,
    'expected explicit opFailureClass to override code-based classification'
  );

  console.log('ops failure injection retrieval hotpath test passed');
} finally {
  syncProcessEnv(prevEnv, Object.keys(prevEnv), { clearMissing: true });
  resetOperationalFailureInjectionState();
}
