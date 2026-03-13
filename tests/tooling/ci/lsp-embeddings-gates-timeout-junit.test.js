#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testLogs', `lsp-embeddings-gates-timeout-${process.pid}-${Date.now()}`);
const gatePath = path.join(root, 'tools', 'ci', 'run-lsp-embeddings-gates.js');
const timeoutProbePath = path.join(tempRoot, 'timeout-probe.test.js');
const testsJsonPath = path.join(tempRoot, 'tests.json');
const junitPath = path.join(tempRoot, 'junit.xml');
const diagnosticsPath = path.join(tempRoot, 'diagnostics.json');
const GATE_TIMEOUT_MS = 20_000;

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

await fs.writeFile(
  timeoutProbePath,
  [
    '#!/usr/bin/env node',
    "setInterval(() => {}, 1000);"
  ].join('\n'),
  'utf8'
);

const timeoutMs = 200;
await fs.writeFile(
  testsJsonPath,
  `${JSON.stringify([{ label: 'timeout-probe', file: timeoutProbePath, timeoutMs }], null, 2)}\n`,
  'utf8'
);

const result = spawnSync(
  process.execPath,
  [
    gatePath,
    '--tests-json',
    testsJsonPath,
    '--junit',
    junitPath,
    '--diagnostics',
    diagnosticsPath
  ],
  {
    cwd: root,
    env: applyTestEnv({ syncProcess: false }),
    encoding: 'utf8',
    timeout: GATE_TIMEOUT_MS
  }
);

assert.equal(result.status, 124, `expected gate timeout exit code 124, received ${result.status}`);

const diagnostics = JSON.parse(await fs.readFile(diagnosticsPath, 'utf8'));
assert.equal(diagnostics?.status, 'error', `expected diagnostics status=error, received ${String(diagnostics?.status)}`);
assert.equal(diagnostics?.failureReason, 'timeout', `expected failureReason=timeout, received ${String(diagnostics?.failureReason)}`);
assert.equal(diagnostics?.results?.[0]?.reason, 'timeout', 'expected timeout reason in gate result payload');

const junitRaw = await fs.readFile(junitPath, 'utf8');
assert.ok(junitRaw.includes('type="timeout"'), 'expected timeout failure type in junit output');
assert.ok(junitRaw.includes(`timed out after ${timeoutMs}ms`), 'expected timeout message in junit output');

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('lsp embeddings gates timeout junit test passed');
