#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const releaseCheckScript = path.join(repoRoot, 'tools', 'release', 'check.js');

const runReleaseCheck = ({ cwd, args = [] }) => spawnSync(
  process.execPath,
  [releaseCheckScript, ...args],
  {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      PAIROFCLEATS_TESTING: '1'
    }
  }
);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-release-gates-'));
await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.1' }, null, 2));
await fs.writeFile(path.join(tempRoot, 'CHANGELOG.md'), '## 0.0.1\n\n- fixture\n');

const base = runReleaseCheck({
  cwd: tempRoot,
  args: ['--blockers-only']
});
assert.notEqual(base.status, 0, 'expected missing/failing blockers to fail release-check');
assert.ok(
  String(base.stderr || '').includes('blocker failed'),
  'expected release-check failure output to identify failing blocker'
);

const overrideWithoutMarker = runReleaseCheck({
  cwd: tempRoot,
  args: [
    '--blockers-only',
    '--allow-blocker-override',
    '--override-id',
    'ops-health-contract',
    '--override-id',
    'ops-failure-injection-contract',
    '--override-id',
    'ops-config-guardrails-contract'
  ]
});
assert.notEqual(
  overrideWithoutMarker.status,
  0,
  'expected override path to fail when marker is missing'
);

const marker = 'INC-OP4-override-test';
const override = runReleaseCheck({
  cwd: tempRoot,
  args: [
    '--blockers-only',
    '--allow-blocker-override',
    '--override-marker',
    marker,
    '--override-id',
    'ops-health-contract',
    '--override-id',
    'ops-failure-injection-contract',
    '--override-id',
    'ops-config-guardrails-contract'
  ]
});
assert.equal(override.status, 0, 'expected explicit blocker overrides to unblock release-check');
assert.ok(
  String(override.stderr || '').includes('[release-override]'),
  'expected override path to emit audit-visible release override record'
);
assert.ok(
  String(override.stderr || '').includes(marker),
  'expected override audit record to include explicit marker'
);
assert.ok(
  String(override.stderr || '').includes('release-blocker-override'),
  'expected override audit payload type to be present for compliance tracing'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('ops release gates essential blockers test passed');
