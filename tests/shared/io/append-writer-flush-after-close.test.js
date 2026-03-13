#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createQueuedAppendWriter } from '../../../src/shared/io/append-writer.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'append-writer-flush-after-close');
const filePath = path.join(tempRoot, 'events.log');
const errors = [];

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const writer = createQueuedAppendWriter({
  filePath,
  syncOnFlush: true,
  onError(stage, err) {
    errors.push({
      stage,
      code: err?.code || null,
      message: err?.message || String(err)
    });
  }
});

await writer.enqueue('first\n');
await writer.close();
await writer.flush();
await writer.enqueue('late\n');
await writer.flush();

const text = await fs.readFile(filePath, 'utf8');
assert.equal(text, 'first\n', 'writer should ignore flush/enqueue calls after close');
assert.deepEqual(errors, [], 'flush after close should not touch a closed handle');

console.log('append writer flush after close test passed');
