#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildTreeSitterChunks,
  initTreeSitterRuntime,
  preloadTreeSitterLanguages,
  pruneTreeSitterLanguages,
  resetTreeSitterParser,
  shutdownTreeSitterWorkerPool
} from '../../src/lang/tree-sitter.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const defaultFile = path.join('tests', 'fixtures', 'tree-sitter', 'swift.swift');

const args = process.argv.slice(2);
let file = null;
let iterations = 1;
let doPrune = false;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (!arg) continue;
  if (arg === '--file') {
    file = args[i + 1] || null;
    i += 1;
    continue;
  }
  if (arg === '--iterations') {
    const raw = args[i + 1];
    iterations = raw ? Number(raw) : 1;
    i += 1;
    continue;
  }
  if (arg === '--prune') {
    doPrune = true;
    continue;
  }
  if (!file) file = arg;
}

if (!Number.isFinite(iterations) || iterations <= 0) iterations = 1;
file = file || defaultFile;

const log = (msg) => console.log(msg);

const formatMem = () => {
  const mem = process.memoryUsage();
  const mb = (n) => `${(Number(n) / 1024 / 1024).toFixed(1)}MB`;
  return `rss=${mb(mem.rss)} heapUsed=${mb(mem.heapUsed)} heapTotal=${mb(mem.heapTotal)} external=${mb(mem.external)}`;
};

const timeout = setTimeout(() => {
  console.error('tree-sitter swift zone OOM repro test timed out');
  process.exit(1);
}, 30000);

try {
  const ok = await initTreeSitterRuntime({ log });
  assert.ok(ok, 'expected tree-sitter runtime to initialize');

  await preloadTreeSitterLanguages(['swift'], { log, parallel: false });
  log(`[repro] loaded swift grammar mem=${formatMem()}`);

  const fullPath = path.isAbsolute(file) ? file : path.join(root, file);
  const text = await fs.readFile(fullPath, 'utf8');

  const options = {
    log,
    treeSitter: {
      enabled: true,
      strict: true
    }
  };

  for (let i = 0; i < iterations; i += 1) {
    const chunks = buildTreeSitterChunks({
      text,
      languageId: 'swift',
      ext: '.swift',
      options
    });
    assert.ok(Array.isArray(chunks) && chunks.length > 0, `expected swift chunks (iter=${i})`);
  }

  log(`[repro] parsed ${iterations} iteration(s) mem=${formatMem()}`);

  if (doPrune) {
    pruneTreeSitterLanguages([], { log });
    resetTreeSitterParser({ hard: true });
    log(`[repro] prune requested; parser reset complete mem=${formatMem()}`);
  }

  console.log('tree-sitter swift zone OOM repro script completed');
} finally {
  clearTimeout(timeout);
  await shutdownTreeSitterWorkerPool();
}


