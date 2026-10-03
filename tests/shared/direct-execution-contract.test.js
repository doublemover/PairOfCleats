#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDirectExecution } from '../../src/shared/direct-execution.js';

const selfPath = fileURLToPath(import.meta.url);

assert.equal(isDirectExecution(import.meta.url, selfPath), true, 'expected current file path to be treated as direct execution');
assert.equal(isDirectExecution(import.meta.url, path.join(path.dirname(selfPath), 'not-this-file.js')), false);
assert.equal(isDirectExecution(import.meta.url, null), false);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-direct-execution-'));
try {
  const realFile = path.join(tempRoot, 'real-entry.js');
  const linkFile = path.join(tempRoot, 'link-entry.js');
  await fs.writeFile(realFile, 'export {};\n', 'utf8');

  try {
    await fs.symlink(realFile, linkFile);
    const moduleUrl = new URL(`file://${realFile.replace(/\\/g, '/')}`);
    assert.equal(isDirectExecution(moduleUrl.href, linkFile), true, 'expected symlinked executed path to resolve to the module realpath');
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EACCES' && error?.code !== 'UNKNOWN') {
      throw error;
    }
    console.log(`direct execution symlink coverage skipped: ${error.code}`);
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('direct execution contract test passed');
