#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getStatus } from '../../../src/integrations/core/status.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-runtime-diagnostics-'));
const repo = path.join(dir, 'repo');
await fs.mkdir(repo);
await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{}');
const run = (script, args, env) => {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000, env: { ...process.env, ...env } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
};
try {
  const cache = path.join(dir, 'base', 'cache');
  await fs.mkdir(cache, { recursive: true });
  const sentinel = path.join(cache, 'sentinel');
  await fs.writeFile(sentinel, 'preserve');
  const env = { PAIROFCLEATS_CACHE_ROOT: path.dirname(cache), PAIROFCLEATS_CACHE_REBUILD: '1', PAIROFCLEATS_NODE_OPTIONS: '--require https://user:secret-canary@example.test/private --trace-warnings', NODE_OPTIONS: '' };
  const before = await fs.readdir(cache, { recursive: true });
  await withTemporaryEnv(env, async () => {
    const status = await getStatus({ repoRoot: repo });
    assert.ok(Array.isArray(status.runtime));
    assert.equal(status.overall.cacheRoot, cache);
  });
  const report = run('tools/index/report-artifacts.js', ['--repo', repo, '--runtime', '--json'], env);
  assert.equal(report.receipts[0].evidence, 'unknown');
  const dump = run('tools/config/dump.js', ['--repo', repo, '--json'], env);
  assert.equal(dump.diagnostic.liveRunReceipt, false);
  assert.equal(dump.derived.capabilityManifest, undefined);
  assert.equal(JSON.stringify(dump).includes('secret-canary'), false);
  const indexDump = run('build_index.js', ['--repo', repo, '--config-dump', '--json'], env);
  assert.equal(JSON.stringify(indexDump).includes('secret-canary'), false);
  assert.equal(indexDump.process.argv.redacted, true);
  assert.deepEqual(await fs.readdir(cache, { recursive: true }), before);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'preserve');
  const absent = path.join(dir, 'absent');
  await withTemporaryEnv({ ...env, PAIROFCLEATS_CACHE_ROOT: absent }, async () => { await getStatus({ repoRoot: repo }); });
  run('tools/index/report-artifacts.js', ['--runtime', '--index-root', absent, '--json'], env);
  await assert.rejects(fs.stat(absent), { code: 'ENOENT' });
  // Explicit root selection remains readable when today's config is invalid.
  await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{');
  const explicit = run('tools/index/report-artifacts.js', ['--repo', repo, '--runtime', '--index-root', absent, '--json'], env);
  assert.equal(explicit.receipts[0].errorCode, 'ENOENT');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('runtime diagnostics read-only and redaction test passed');
