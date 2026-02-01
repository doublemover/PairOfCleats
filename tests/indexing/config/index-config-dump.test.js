#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildIndexPath = path.join(root, 'build_index.js');

const result = spawnSync(process.execPath, [buildIndexPath, '--config-dump', '--json'], {
  cwd: root,
  env: process.env,
  encoding: 'utf8'
});

assert.strictEqual(result.status, 0, `config dump exited with ${result.status}: ${result.stderr || ''}`);
const output = String(result.stdout || '').trim();
assert.ok(output, 'expected config dump output');
const parsed = JSON.parse(output);
assert.strictEqual(parsed.schemaVersion, 1, 'schemaVersion should be 1');
assert.ok(parsed.runtime, 'runtime should be present');
assert.ok(parsed.concurrency, 'concurrency should be present');
assert.ok(parsed.queues, 'queues should be present');
assert.ok(parsed.envPatch, 'envPatch should be present');

console.log('index config dump test passed');
