#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'indexer-service');
const repoRoot = path.join(tempRoot, 'repo');
const queueDir = path.join(tempRoot, 'queue');
const configPath = path.join(tempRoot, 'service.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

const config = {
  queueDir,
  repos: [
    { id: 'repo', path: repoRoot, syncPolicy: 'none' }
  ]
};
await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));

const enqueue = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'indexer-service.js'), 'enqueue', '--config', configPath, '--repo', repoRoot, '--mode', 'code'],
  { encoding: 'utf8' }
);
if (enqueue.status !== 0) {
  console.error(enqueue.stderr || enqueue.stdout || 'indexer-service enqueue failed');
  process.exit(enqueue.status ?? 1);
}

const status = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'indexer-service.js'), 'status', '--config', configPath],
  { encoding: 'utf8' }
);
if (status.status !== 0) {
  console.error(status.stderr || status.stdout || 'indexer-service status failed');
  process.exit(status.status ?? 1);
}

const payload = JSON.parse(status.stdout || '{}');
assert.equal(payload.queue?.queued, 1);
assert.ok(fs.existsSync(path.join(queueDir, 'queue.json')));

console.log('indexer service test passed');
