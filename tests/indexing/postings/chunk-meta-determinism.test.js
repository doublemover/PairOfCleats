#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoId } from '../../../tools/shared/dict-utils.js';
import { loadChunkMeta, MAX_JSON_BYTES } from '../../../src/shared/artifact-io.js';
import { resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';
import { stableStringifyForSignature } from '../../../src/shared/stable-json.js';
import { sha1 } from '../../../src/shared/hash.js';
import { rmDirRecursive } from '../../helpers/temp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();
const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const runId = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
const benchRoot = resolveTestCachePath(root, 'chunk-meta-determinism', runId);
const buildIndexPath = path.join(root, 'build_index.js');

const safeRm = async (dir) => {
  await rmDirRecursive(dir, { retries: 8, delayMs: 150, ignoreRetryableFailure: true });
};

const readBuildRoot = async (cacheRoot) => {
  const versioned = resolveVersionedCacheRoot(cacheRoot);
  const repoId = getRepoId(fixtureRoot);
  const repoCacheRoot = path.join(versioned, 'repos', repoId);
  const currentPath = path.join(repoCacheRoot, 'builds', 'current.json');
  const raw = await fs.readFile(currentPath, 'utf8');
  const data = JSON.parse(raw) || {};
  const buildId = typeof data.buildId === 'string' ? data.buildId : null;
  const buildRootRaw = typeof data.buildRoot === 'string' ? data.buildRoot : null;
  const buildRoot = buildRootRaw
    ? (path.isAbsolute(buildRootRaw) ? buildRootRaw : path.join(repoCacheRoot, buildRootRaw))
    : (buildId ? path.join(repoCacheRoot, 'builds', buildId) : null);
  if (!buildRoot) throw new Error('Missing buildRoot in current.json');
  return { repoCacheRoot, buildRoot };
};

const readVocabOrder = async (indexDir) => {
  const vocabOrderPath = path.join(indexDir, 'vocab_order.json');
  if (!fsSync.existsSync(vocabOrderPath)) {
    throw new Error(`Missing vocab_order.json at ${vocabOrderPath}`);
  }
  const raw = await fs.readFile(vocabOrderPath, 'utf8');
  const parsed = JSON.parse(raw);
  const payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed.fields || parsed) : null;
  const vocab = payload?.vocab || null;
  if (!vocab || typeof vocab !== 'object') {
    throw new Error(`Invalid vocab_order.json at ${vocabOrderPath}`);
  }
  return vocab;
};

const hashPayload = (payload) => sha1(stableStringifyForSignature(payload));

const formatBuildFailure = (label, result) => {
  const status = result?.status ?? null;
  const signal = result?.signal ?? null;
  const stdout = String(result?.stdout || '').trim();
  const stderr = String(result?.stderr || '').trim();
  const sections = [`build_index failed for ${label} (status=${status}, signal=${signal})`];
  if (stdout) sections.push(`--- stdout ---\n${stdout}`);
  if (stderr) sections.push(`--- stderr ---\n${stderr}`);
  return sections.join('\n');
};

const runBuild = async ({ label, threads }) => {
  const cacheRoot = path.join(benchRoot, label);
  await safeRm(cacheRoot);
  await fs.mkdir(cacheRoot, { recursive: true });
  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub'
  });
  const args = [
    buildIndexPath,
    '--mode',
    'code',
    '--stage',
    'stage1',
    '--threads',
    String(threads),
    '--stub-embeddings',
    '--scm-provider',
    'none',
    '--repo',
    fixtureRoot,
    '--quiet',
    '--progress',
    'off'
  ];
  const result = spawnSync(process.execPath, args, { cwd: fixtureRoot, env, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(formatBuildFailure(label, result));
  }
  const { buildRoot } = await readBuildRoot(cacheRoot);
  const indexDir = path.join(buildRoot, 'index-code');
  const chunkMeta = await loadChunkMeta(indexDir, { maxBytes: MAX_JSON_BYTES, strict: false });
  const vocabOrder = await readVocabOrder(indexDir);
  return {
    chunkMetaHash: hashPayload(chunkMeta),
    vocabOrderHash: hashPayload(vocabOrder),
    chunkCount: Array.isArray(chunkMeta) ? chunkMeta.length : 0
  };
};

try {
  const runA = await runBuild({ label: 'run-a', threads: 1 });
  const runB = await runBuild({ label: 'run-b', threads: 4 });

  assert.ok(runA.chunkCount > 0, 'expected chunk_meta to include chunks');
  assert.equal(runA.chunkMetaHash, runB.chunkMetaHash, 'chunk_meta should be deterministic across concurrency');
  assert.equal(runA.vocabOrderHash, runB.vocabOrderHash, 'vocab_order should be deterministic across concurrency');

  console.log('chunk meta determinism test passed');
} finally {
  await safeRm(benchRoot);
}
