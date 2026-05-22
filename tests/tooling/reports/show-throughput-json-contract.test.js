#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';
import {
  createShowThroughputTempRoot,
  runShowThroughputReport,
  writeShowThroughputPayload
} from './show-throughput-report-fixture.js';

const tempRoot = await createShowThroughputTempRoot('poc-show-throughput-json-contract-');

try {
  const runRoot = path.join(tempRoot, 'workspace');
  const resultsRoot = path.join(runRoot, 'benchmarks', 'results');
  await writeShowThroughputPayload(resultsRoot, { folder: 'zeta', repoName: 'owner__repo-z', chunksPerSec: 10 });
  await writeShowThroughputPayload(resultsRoot, { folder: 'alpha', repoName: 'owner__repo-a', chunksPerSec: 20 });

  const result = runShowThroughputReport(['--profile', 'raw', '--json'], { cwd: runRoot });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(String(result.stderr || '').trim(), '', 'expected stderr to stay empty on successful raw export');

  const payload = JSON.parse(String(result.stdout || '{}'));
  const schema = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'docs', 'schemas', 'show-throughput-report.schema.json'), 'utf8')
  );
  const ajv = createAjv({ dialect: '2020', allErrors: true, strict: false, validateFormats: false });
  const validate = compileSchema(ajv, schema);
  assert.equal(validate(payload), true, JSON.stringify(validate.errors || [], null, 2));
  assert.deepEqual(
    (payload.folders || []).map((entry) => entry.folder),
    ['alpha', 'zeta'],
    'expected deterministic folder ordering in raw JSON'
  );
  assert.equal(typeof payload.ciSummary, 'object', 'expected CI-facing summary block');

  console.log('show-throughput json contract test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
