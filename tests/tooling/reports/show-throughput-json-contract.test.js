#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';

ensureTestingEnv(process.env);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-show-throughput-json-contract-'));

const writePayload = async (resultsRoot, folder, repoName, chunksPerSec) => {
  const dir = path.join(resultsRoot, folder);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${repoName}.json`),
    JSON.stringify({
      generatedAt: '2026-03-21T00:00:00.000Z',
      repo: { root: `C:/repo/${repoName}` },
      summary: {
        buildMs: { index: 100, sqlite: 40 },
        queryWallMsPerQuery: 10,
        queryWallMsPerSearch: 20,
        latencyMs: { memory: { mean: 2, p95: 4 } }
      },
      artifacts: {
        throughput: {
          code: {
            files: 10,
            chunks: chunksPerSec * 10,
            tokens: 1000,
            bytes: 10000,
            totalMs: 10000,
            filesPerSec: 5,
            chunksPerSec,
            tokensPerSec: 100,
            bytesPerSec: 1000
          }
        }
      }
    }, null, 2),
    'utf8'
  );
};

try {
  const runRoot = path.join(tempRoot, 'workspace');
  const resultsRoot = path.join(runRoot, 'benchmarks', 'results');
  await writePayload(resultsRoot, 'zeta', 'owner__repo-z', 10);
  await writePayload(resultsRoot, 'alpha', 'owner__repo-a', 20);

  const result = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'tools', 'reports', 'show-throughput.js'),
      '--profile', 'raw',
      '--json'
    ],
    { cwd: runRoot, encoding: 'utf8', env: process.env }
  );
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
