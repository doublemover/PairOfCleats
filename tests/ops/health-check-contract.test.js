#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  HEALTH_CHECK_CODES,
  formatHealthFailure,
  runIndexingHealthChecks,
  runRetrievalHealthChecks
} from '../../src/shared/ops-health.js';
import { createRunnerHelpers } from '../../src/retrieval/cli/runner.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-op-health-'));

const indexingHealth = runIndexingHealthChecks({
  mode: 'code',
  runtime: { buildRoot: tempRoot },
  outDir: tempRoot
});
assert.equal(indexingHealth.ok, true, 'expected indexing health checks to pass for valid inputs');

const retrievalHealth = runRetrievalHealthChecks({
  query: '',
  runCode: false,
  runProse: false,
  runExtractedProse: false,
  runRecords: false,
  backendLabel: ''
});
assert.equal(retrievalHealth.ok, false, 'expected retrieval health checks to fail for invalid inputs');
assert.deepEqual(
  retrievalHealth.failures.map((entry) => entry.code),
  [
    HEALTH_CHECK_CODES.RETRIEVAL_QUERY_EMPTY,
    HEALTH_CHECK_CODES.RETRIEVAL_MODE_MISSING,
    HEALTH_CHECK_CODES.RETRIEVAL_BACKEND_MISSING
  ],
  'expected stable machine-readable health-check failure codes'
);

const firstFailure = retrievalHealth.failures[0];
const formatted = formatHealthFailure(firstFailure);
assert.ok(formatted.includes(`code=${HEALTH_CHECK_CODES.RETRIEVAL_QUERY_EMPTY}`), 'expected health code in log line');
assert.ok(formatted.includes('component=retrieval'), 'expected component context in log line');
assert.ok(formatted.includes('next="Provide a non-empty query string."'), 'expected actionable next step in log line');

const logLines = [];
const originalError = console.error;
console.error = (...args) => {
  logLines.push(args.map((value) => String(value)).join(' '));
};
try {
  const helpers = createRunnerHelpers({
    emitOutput: true,
    exitOnError: false,
    jsonOutput: false,
    recordSearchMetrics: () => {},
    signal: null
  });
  assert.throws(() => {
    helpers.ensureRetrievalHealth({
      query: '',
      runCode: false,
      runProse: false,
      runExtractedProse: false,
      runRecords: false,
      backendLabel: ''
    });
  }, /op_health_retrieval_query_empty/, 'expected retrieval health failure to throw actionable error');
} finally {
  console.error = originalError;
}

assert.ok(
  logLines.some((line) => line.includes('component=retrieval') && line.includes('next="Provide a non-empty query string."')),
  'expected emitted log to include failure type, component context, and next action'
);

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('ops health check contract test passed');
