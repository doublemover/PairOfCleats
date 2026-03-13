#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const scriptPath = path.join(repoRoot, 'tools', 'config', 'dump.js');
const result = spawnSync(process.execPath, [scriptPath, '--json'], { encoding: 'utf8', cwd: repoRoot });
if (result.status !== 0) {
  throw new Error(`config-dump failed: ${result.stderr || result.stdout}`);
}
const payload = JSON.parse(result.stdout || '{}');
if (!payload.repoRoot) {
  throw new Error('config-dump did not report repoRoot.');
}
if (!payload.derived || !payload.derived.cacheRoot) {
  throw new Error('config-dump did not include derived cacheRoot.');
}
console.log('Config dump test passed');
