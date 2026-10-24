#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const { dir } = await prepareIsolatedTestCacheDir('postings-real-failure-contract', { root, clean: true });
const target = path.join(root, 'tests/indexing/postings/real-bench-contract.test.js');
const env = applyTestEnv({ syncProcess: false });

try {
  for (const mode of ['timeout', 'failure', 'success']) {
    const hook = path.join(dir, `${mode}.mjs`);
    await fs.writeFile(hook, `
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      const original = childProcess.spawnSync;
      const mode = ${JSON.stringify(mode)};
      childProcess.spawnSync = (command, args, options) => {
        if (!args?.some(arg => /tools[\\\\/]bench[\\\\/]index[\\\\/]postings-real\\.js$/.test(String(arg)))) {
          return original.call(childProcess, command, args, options);
        }
        const stdout = mode === 'success' ? '[bench] baseline controlled result' : '';
        const stderr = mode === 'failure' ? 'injected benchmark failure' : '';
        return { pid: 0, status: mode === 'timeout' ? null : mode === 'failure' ? 7 : 0,
          signal: mode === 'timeout' ? 'SIGTERM' : null, stdout, stderr,
          output: [null, stdout, stderr],
          ...(mode === 'timeout' ? { error: Object.assign(new Error('Injected benchmark deadline'), { code: 'ETIMEDOUT' }) } : {}) };
      };
      syncBuiltinESMExports();
    `);
    const result = runNode(['--import', pathToFileURL(hook).href, target], `postings wrapper ${mode}`, root, env, {
      stdio: 'pipe', allowFailure: true, timeoutMs: 5000
    });
    assert.equal(result.error, undefined, 'the control must finish before its own deadline');
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (mode === 'success') {
      assert.equal(result.status, 0, output);
      assert.match(output, /postings real bench contract test passed/);
    } else {
      assert.equal(result.status, mode === 'timeout' ? 1 : 7, output);
      assert.doesNotMatch(output, /contract test passed|contract skipped/);
      assert.match(output, mode === 'timeout' ? /ETIMEDOUT|timeout after 30000ms/ : /injected benchmark failure/);
    }
  }
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}

console.log('Postings benchmark wrapper rejects timeout and nonzero controls; real benchmark acceptance is separate.');
