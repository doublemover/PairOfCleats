#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildEmbeddingsArgs, normalizeEmbeddingJob } from '../../../tools/service/indexer-service-helpers.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'indexer-service');
const repoRoot = path.join(tempRoot, 'repo');
const queueDir = path.join(tempRoot, 'queue');
const configPath = path.join(tempRoot, 'service.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

const buildRoot = path.join(repoRoot, 'builds', 'b1');
const indexDir = path.join(buildRoot, 'index-code');
const normalized = normalizeEmbeddingJob({
  repoRoot,
  buildRoot,
  indexDir,
  mode: 'code',
  embeddingPayloadFormatVersion: 2
});
assert.equal(normalized.buildRoot, path.resolve(buildRoot));
assert.equal(normalized.indexDir, path.resolve(indexDir));

const buildPath = path.join(root, 'tools', 'build', 'embeddings.js');
const args = buildEmbeddingsArgs({
  buildPath,
  repoPath: repoRoot,
  mode: 'code',
  indexRoot: normalized.buildRoot
});
const indexFlag = args.indexOf('--index-root');
assert.ok(indexFlag >= 0, 'expected --index-root arg');
assert.equal(args[indexFlag + 1], normalized.buildRoot);

const config = {
  queueDir,
  repos: [
    { id: 'repo', path: repoRoot, syncPolicy: 'none' }
  ]
};
await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));

const enqueue = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'service', 'indexer-service.js'), 'enqueue', '--config', configPath, '--repo', repoRoot, '--mode', 'code'],
  { encoding: 'utf8' }
);
if (enqueue.status !== 0) {
  console.error(enqueue.stderr || enqueue.stdout || 'indexer-service enqueue failed');
  process.exit(enqueue.status ?? 1);
}
const enqueuePayload = JSON.parse(enqueue.stdout || '{}');
assert.equal(enqueuePayload.ok, true);
assert.equal(enqueuePayload.duplicate, false);
assert.ok(typeof enqueuePayload.idempotencyKey === 'string' && enqueuePayload.idempotencyKey.length > 0);

const duplicateEnqueue = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'service', 'indexer-service.js'), 'enqueue', '--config', configPath, '--repo', repoRoot, '--mode', 'code'],
  { encoding: 'utf8' }
);
if (duplicateEnqueue.status !== 0) {
  console.error(duplicateEnqueue.stderr || duplicateEnqueue.stdout || 'indexer-service duplicate enqueue failed');
  process.exit(duplicateEnqueue.status ?? 1);
}
const duplicatePayload = JSON.parse(duplicateEnqueue.stdout || '{}');
assert.equal(duplicatePayload.ok, true);
assert.equal(duplicatePayload.duplicate, true);
assert.equal(duplicatePayload.replaySuppressed, true);
assert.equal(duplicatePayload.job?.id, enqueuePayload.job?.id);

const status = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'service', 'indexer-service.js'), 'status', '--config', configPath],
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

