#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-dump-readonly-'));
try {
  const repo = path.join(temp, 'repo');
  const base = path.join(temp, 'owned');
  const sentinel = path.join(base, 'cache', 'sentinel');
  await fs.mkdir(repo);
  await fs.mkdir(path.dirname(sentinel), { recursive: true });
  await fs.writeFile(sentinel, 'preserve');
  const env = applyTestEnv({ syncProcess: false, extraEnv: {
    PAIROFCLEATS_CACHE_ROOT: base, PAIROFCLEATS_CACHE_REBUILD: '1'
  } });
  const invocations = [
    ['tools/config/dump.js', '--repo', repo, '--json'],
    ['build_index.js', '--repo', repo, '--config-dump', '--json', '--threads', '8', '--quality', 'fast']
  ];
  for (const args of invocations) {
    const result = spawnSync(process.execPath, args, { cwd: process.cwd(), env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'preserve');
    assert.deepEqual(await fs.readdir(path.dirname(sentinel)), ['sentinel']);
    if (args[0] === 'build_index.js') {
      const preview = JSON.parse(result.stdout);
      assert.equal(preview.diagnostic.liveRunReceipt, false);
      assert.ok(preview.concurrency.cpuCount > 0);
      assert.equal(preview.process.nodeVersion, process.version);
      assert.ok(preview.process.pid > 0);
      assert.ok(preview.process.execPath);
      if (os.cpus().length > 1) assert.ok(preview.concurrency.cpuCount > 1);
    }
  }
  await fs.rm(base, { recursive: true });
  for (const args of invocations) {
    const result = spawnSync(process.execPath, args, { cwd: process.cwd(), env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(fs.stat(base), { code: 'ENOENT' });
  }
  console.log('config dump read-only host test passed');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
