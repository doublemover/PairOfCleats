#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const projectRoot = process.cwd();
const env = applyTestEnv({ syncProcess: false });
const tempRoot = resolveTestCachePath(projectRoot, 'get-last-failure-latest-pointer');
await fs.rm(tempRoot, { recursive: true, force: true });

const latestRunDir = path.join(tempRoot, 'custom-run-logs', 'run-001');
const latestLogPath = path.join(latestRunDir, 'failure.log');
await fs.mkdir(latestRunDir, { recursive: true });
await fs.writeFile(latestLogPath, 'Failed: synthetic failure\nexit: 1\n', 'utf8');

const latestPointerPath = path.join(tempRoot, '.testLogs', 'latest');
await fs.mkdir(path.dirname(latestPointerPath), { recursive: true });
const latestPointerValue = path.relative(tempRoot, latestRunDir).replace(/\\/g, '/');
await fs.writeFile(latestPointerPath, `${latestPointerValue}\n`, 'utf8');

const scriptPath = path.join(projectRoot, 'tools', 'ci', 'get-last-failure.js');
const result = runNode([scriptPath], 'get last failure latest pointer', tempRoot, env, { stdio: 'pipe' });

assert.equal(result.status, 0, `expected script to succeed, stderr=${result.stderr || ''}`);
const stderrLines = String(result.stderr || '')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const selectedPath = stderrLines[stderrLines.length - 1] || '';
assert.ok(selectedPath, 'expected selected log path on stderr');
assert.equal(
  path.resolve(selectedPath),
  path.resolve(latestLogPath),
  'expected script to use .testLogs/latest pointer target'
);

console.log('get-last-failure latest pointer test passed');
