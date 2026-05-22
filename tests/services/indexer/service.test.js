#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  buildEmbeddingsArgs,
  normalizeEmbeddingJob,
  resolveEmbeddingBackendStageDir
} from '../../../tools/service/indexer-service-helpers.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'indexer-service');
const repoRoot = path.join(tempRoot, 'repo');
const queueDir = path.join(tempRoot, 'queue');
const configPath = path.join(tempRoot, 'service.json');
const env = applyTestEnv({ syncProcess: false });
const servicePath = path.join(root, 'tools', 'service', 'indexer-service.js');
const runServiceCli = (args, label) => runNode(
  [servicePath, ...args],
  label,
  root,
  env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

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
assert.equal(normalized.indexDirUnderBuildRoot, true);

const normalizedIndexOnly = normalizeEmbeddingJob({
  repoRoot,
  indexDir,
  mode: 'code',
  embeddingPayloadFormatVersion: 2
});
assert.equal(normalizedIndexOnly.buildRoot, path.resolve(buildRoot));
assert.equal(normalizedIndexOnly.indexDir, path.resolve(indexDir));
assert.equal(normalizedIndexOnly.indexDirUnderBuildRoot, true);
assert.equal(
  resolveEmbeddingBackendStageDir(normalizedIndexOnly, 'code'),
  path.join(buildRoot, '.embeddings-backend-staging', 'index-code')
);

const legacyIndexRoot = normalizeEmbeddingJob({
  repoRoot,
  indexRoot: indexDir,
  mode: 'code',
  embeddingPayloadFormatVersion: 1
});
assert.equal(legacyIndexRoot.buildRoot, path.resolve(buildRoot));
assert.equal(legacyIndexRoot.indexDir, path.resolve(indexDir));
assert.equal(legacyIndexRoot.legacyIndexRoot, path.resolve(indexDir));

const outsideIndexDir = path.join(repoRoot, 'outside', 'index-code');
const normalizedOutside = normalizeEmbeddingJob({
  repoRoot,
  buildRoot,
  indexDir: outsideIndexDir,
  mode: 'code',
  embeddingPayloadFormatVersion: 2
});
assert.equal(normalizedOutside.indexDirUnderBuildRoot, false);

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

const enqueue = runServiceCli(
  ['enqueue', '--config', configPath, '--repo', repoRoot, '--mode', 'code'],
  'indexer-service enqueue'
);
if (enqueue.status !== 0) {
  console.error(enqueue.stderr || enqueue.stdout || 'indexer-service enqueue failed');
  process.exit(enqueue.status ?? 1);
}
const enqueuePayload = JSON.parse(enqueue.stdout || '{}');
assert.equal(enqueuePayload.ok, true);
assert.equal(enqueuePayload.duplicate, false);
assert.ok(typeof enqueuePayload.idempotencyKey === 'string' && enqueuePayload.idempotencyKey.length > 0);

const duplicateEnqueue = runServiceCli(
  ['enqueue', '--config', configPath, '--repo', repoRoot, '--mode', 'code'],
  'indexer-service duplicate enqueue'
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

const status = runServiceCli(
  ['status', '--config', configPath],
  'indexer-service status'
);
if (status.status !== 0) {
  console.error(status.stderr || status.stdout || 'indexer-service status failed');
  process.exit(status.status ?? 1);
}

const payload = JSON.parse(status.stdout || '{}');
assert.equal(payload.queue?.queued, 1);
assert.ok(fs.existsSync(path.join(queueDir, 'queue.json')));

console.log('indexer service test passed');

