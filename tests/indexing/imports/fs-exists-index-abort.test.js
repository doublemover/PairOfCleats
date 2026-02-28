#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFsExistsIndex } from '../../../src/index/build/import-resolution.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'fs-exists-index-abort');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'src', 'main.ts'), 'export {};\n', 'utf8');

const controller = new AbortController();
controller.abort();

await assert.rejects(
  () => createFsExistsIndex({
    root: tempRoot,
    entries: [{ rel: 'src/main.ts' }],
    abortSignal: controller.signal
  }),
  (error) => error?.code === 'ABORT_ERR',
  'expected fs-exists-index construction to honor pre-aborted signals'
);

console.log('fs exists index abort test passed');
