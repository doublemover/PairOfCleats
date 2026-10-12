#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-early-log-'));
try {
  const repo = path.join(temp, 'repo');
  const logFile = path.join(temp, 'logs', 'build.jsonl');
  await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({
    quality: 'fast', threads: 1,
    indexing: { scm: { provider: 'none' }, workerPool: { enabled: false },
      embeddings: { enabled: false, mode: 'off' }, platformPresets: { startupCalibration: false } },
    tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
  }));
  const source = `
    import { createBuildRuntime } from './src/index/build/runtime/runtime.js';
    import { teardownRuntime } from './src/integrations/core/build-index/runtime.js';
    const runtime = await createBuildRuntime({ root: ${JSON.stringify(repo)},
      argv: { stage: 'stage1', threads: 1, 'log-file': ${JSON.stringify(logFile)} }, rawArgv: [] });
    await teardownRuntime(runtime);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 20000,
    env: applyTestEnv({ syncProcess: false, cacheRoot: path.join(temp, 'cache'), embeddings: 'off' })
  });
  assert.equal(result.status, 0, result.stderr);
  const rows = (await fs.readFile(logFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  for (const prefix of ['[init] cache root (', '[init] repo cache root:', '[init] build root:']) {
    assert.equal(rows.filter(row => row.msg.startsWith(prefix)).length, 1, `${prefix} appears once`);
  }
  assert.ok(rows.some(row => row.buildId), 'later records carry the resolved build context');
  console.log('early path log test passed');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
