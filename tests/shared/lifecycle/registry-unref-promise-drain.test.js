#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { ensureTestingEnv } from '../../helpers/test-env.js';

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
assert.match(result.stdout, /registry keepalive ok/, 'expected keepalive child to complete drain');
assert.doesNotMatch(
  `${result.stderr || ''}${result.stdout || ''}`,
  /Detected unsettled top-level await/,
  'expected no unsettled top-level await warning'
);

await fs.rm(scriptPath, { force: true });

console.log('lifecycle registry unref promise drain test passed');
