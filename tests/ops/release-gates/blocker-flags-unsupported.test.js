#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';

applyTestEnv();

const repoRoot = process.cwd();
const releaseCheckScript = path.join(repoRoot, 'tools', 'release', 'check.js');
const env = applyTestEnv({ syncProcess: false });

const runReleaseCheck = ({ cwd, args = [] }) => runNode(
  [releaseCheckScript, ...args],
  'release check unsupported blocker flags',
  cwd,
  env,
  { stdio: 'pipe', allowFailure: true }
);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-release-gates-'));
await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.1' }, null, 2));
await fs.writeFile(path.join(tempRoot, 'CHANGELOG.md'), '## 0.0.1\n\n- fixture\n');

const cases = [
  ['--blockers-only'],
  ['--no-blockers'],
  ['--allow-blocker-override'],
  ['--override-id', 'ops-health-contract'],
  ['--override-marker', 'INC-123']
];

for (const args of cases) {
  const result = runReleaseCheck({ cwd: tempRoot, args });
  assert.notEqual(result.status, 0, `expected non-zero for unsupported args: ${args.join(' ')}`);
  assert.ok(
    String(result.stderr || '').includes('blocker-related flags are no longer supported'),
    `expected unsupported flag error for args: ${args.join(' ')}`
  );
}

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('ops release gates blocker flags unsupported test passed');
