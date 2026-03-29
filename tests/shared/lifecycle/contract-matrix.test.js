#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import { createLifecycleRegistry } from '../../../src/shared/lifecycle/registry.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

{
  const asyncCloseError = new Error('async disposer close failed');
  const reportedErrors = [];
  const unhandledRejections = [];
  const onUnhandledRejection = (reason) => unhandledRejections.push(reason);
  process.on('unhandledRejection', onUnhandledRejection);
  try {
    const registry = createLifecycleRegistry({
      name: 'lifecycle-disposer-async-close',
      onError: (err) => reportedErrors.push(err)
    });
    const unregister = registry.register(null, {
      label: 'async-close',
      close: async () => {
        throw asyncCloseError;
      }
    });
    unregister();
    await sleep(20);
    assert.equal(reportedErrors.length, 1);
    assert.equal(reportedErrors[0], asyncCloseError);
    assert.equal(unhandledRejections.length, 0);
    await registry.close();
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }
}

{
  const registry = createLifecycleRegistry({ name: 'lifecycle-contract' });
  let ticks = 0;
  const interval = setInterval(() => {
    ticks += 1;
  }, 5);
  registry.registerTimer(interval, { label: 'contract-interval' });
  let cleanupCalls = 0;
  registry.registerCleanup(() => {
    cleanupCalls += 1;
  }, { label: 'contract-cleanup' });
  let resolved = false;
  registry.registerPromise((async () => {
    await sleep(20);
    resolved = true;
  })(), { label: 'contract-promise' });
  await registry.drain();
  assert.equal(resolved, true);
  await sleep(20);
  const beforeCloseTicks = ticks;
  await registry.close();
  await sleep(20);
  assert.equal(ticks, beforeCloseTicks);
  assert.equal(cleanupCalls, 1);
  assert.throws(() => registry.registerCleanup(() => {}, { label: 'after-close' }));

  const workerRegistry = createLifecycleRegistry({ name: 'worker-contract' });
  let terminated = false;
  workerRegistry.registerWorker({ terminate: async () => { terminated = true; } }, { label: 'worker' });
  await workerRegistry.close();
  assert.equal(terminated, true);
}

{
  const childScript = [
    "import { createLifecycleRegistry } from './src/shared/lifecycle/registry.js';",
    "const registry = createLifecycleRegistry({ name: 'registry-pending-keepalive' });",
    "registry.registerPromise(new Promise(() => {}), { label: 'never-settles' });",
    'await registry.drain();'
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  await sleep(200);
  assert.equal(child.exitCode, null, `expected child to remain alive; stderr=${stderr || '<empty>'}`);
  child.kill();
  const closeResult = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  assert.notEqual(closeResult.exitCode, 13);
}

{
  ensureTestingEnv(process.env);
  const root = process.cwd();
  const tempDir = path.join(root, '.testLogs', 'lifecycle');
  await fs.mkdir(tempDir, { recursive: true });
  const scriptPath = path.join(tempDir, `registry-unref-promise-drain-${process.pid}-${Date.now()}.mjs`);
  const registryUrl = pathToFileURL(path.join(root, 'src', 'shared', 'lifecycle', 'registry.js')).href;
  await fs.writeFile(scriptPath, [
    `import { createLifecycleRegistry } from ${JSON.stringify(registryUrl)};`,
    'const registry = createLifecycleRegistry({ name: "registry-unref-promise-drain" });',
    'registry.registerPromise(new Promise((resolve) => {',
    '  const timer = setTimeout(resolve, 25);',
    '  timer.unref?.();',
    '}), { label: "unref-promise" });',
    'await registry.drain();',
    'console.log("registry keepalive ok");'
  ].join('\n'), 'utf8');
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000
  });
  assert.equal(result.status, 0, `expected child to exit cleanly, stderr=${result.stderr}`);
  assert.match(result.stdout, /registry keepalive ok/);
  assert.doesNotMatch(`${result.stderr || ''}${result.stdout || ''}`, /Detected unsettled top-level await/);
  await fs.rm(scriptPath, { force: true });
}

console.log('shared lifecycle contract matrix test passed');
