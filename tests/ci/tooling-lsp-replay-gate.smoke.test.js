#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../helpers/test-env.js';

const ROOT = process.cwd();
const gatePath = path.join(ROOT, 'tools', 'ci', 'tooling-lsp-replay-gate.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-tooling-lsp-replay-gate-'));
const jsonPath = path.join(tempRoot, 'tooling-lsp-replay-gate.json');

try {
  const result = spawnSync(
    process.execPath,
    [gatePath, '--json', jsonPath],
    {
      cwd: ROOT,
      env: applyTestEnv({ syncProcess: false }),
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    console.error('tooling lsp replay gate smoke test failed');
    console.error(result.stderr || result.stdout || '');
  }
  assert.equal(result.status, 0, `expected tooling lsp replay gate status=0, received ${result.status}`);

  const payload = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  assert.equal(payload?.status, 'ok', `expected status=ok, received ${String(payload?.status)}`);
  assert.equal(Array.isArray(payload?.summary?.outboundRequests), true, 'expected outbound request summary');
  assert.equal(payload.summary.outboundRequests.includes('initialize'), true, 'expected initialize in replay trace');
  assert.equal(payload.summary.outboundRequests.includes('textDocument/hover'), true, 'expected hover in replay trace');
  assert.equal(Number(payload?.summary?.pendingRequestCount || 0), 0, 'expected replay summary without pending requests');

  console.log('tooling lsp replay gate smoke test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
