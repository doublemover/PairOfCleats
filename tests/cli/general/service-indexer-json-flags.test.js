#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { runServiceIndexerJson } from '../../helpers/service-indexer-json-fixture.js';

ensureTestingEnv(process.env);

const statusPayload = await runServiceIndexerJson({
  testCacheDir: 'service-indexer-json-flags-status',
  subcommand: 'status'
});
assert.equal(statusPayload?.ok, true, 'expected status payload to report ok=true');
assert.equal(typeof statusPayload?.queue?.total, 'number', 'expected queue.total in status payload');

const smokePayload = await runServiceIndexerJson({
  testCacheDir: 'service-indexer-json-flags-smoke',
  subcommand: 'smoke'
});
assert.equal(smokePayload?.ok, true, 'expected smoke payload to report ok=true');
assert.equal(typeof smokePayload?.canonicalCommand, 'string', 'expected canonicalCommand in smoke payload');
assert.equal(typeof smokePayload?.queueSummary?.total, 'number', 'expected queueSummary.total in smoke payload');
assert.equal(Array.isArray(smokePayload?.requiredEnv), true, 'expected requiredEnv array in smoke payload');

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-indexer-json-'));
const configPath = path.join(tempRoot, 'service.json');
await fs.writeFile(configPath, JSON.stringify({
  queueDir: path.join(tempRoot, 'queue'),
  repos: []
}, null, 2), 'utf8');
const scriptPath = path.join(process.cwd(), 'tools', 'service', 'indexer-service.js');
const invalidCommand = spawnSync(
  process.execPath,
  [scriptPath, 'invalid-command', '--json', '--config', configPath],
  { encoding: 'utf8' }
);
assert.equal(invalidCommand.status, 1, 'expected invalid command to exit 1');
const invalidPayload = JSON.parse(String(invalidCommand.stdout || '{}') || '{}');
assert.equal(invalidPayload?.ok, false, 'expected invalid command JSON payload ok=false');
assert.match(String(invalidPayload?.error || ''), /Usage:\s*indexer-service/i);
await fs.rm(tempRoot, { recursive: true, force: true });

console.log('service indexer --json flags test passed');
