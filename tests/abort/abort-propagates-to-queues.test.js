#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import PQueue from 'p-queue';
import { scanImports } from '../../src/index/build/imports.js';
import { isAbortError } from '../../src/shared/abort.js';

const makeFixtureRepo = async (count = 80) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-abort-queue-'));
  const entries = [];
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  for (let i = 0; i < count; i += 1) {
    const filePath = path.join(root, 'src', `file-${i}.js`);
    const content = `import x from './mod-${i}.js';\nconst n = ${i};\nexport default n + 1;\n`;
    await fs.writeFile(filePath, content, 'utf8');
    entries.push(filePath);
  }
  return { root, entries };
};

const cleanup = async (root) => {
  try {
    await fs.rm(root, { recursive: true, force: true });
  } catch {}
};

const queue = new PQueue({ concurrency: 1 });
const controller = new AbortController();

const { root, entries } = await makeFixtureRepo();

setTimeout(() => controller.abort(), 10);

try {
  await scanImports({
    files: entries,
    root,
    mode: 'code',
    languageOptions: {},
    importConcurrency: 1,
    queue,
    abortSignal: controller.signal
  });
  assert.fail('expected abort');
} catch (err) {
  assert.ok(isAbortError(err), `expected AbortError, got ${err?.name || err}`);
} finally {
  await cleanup(root);
}

console.log('abort propagation to queue test passed');
