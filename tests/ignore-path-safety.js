#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildIgnoreMatcher } from '../src/index/build/ignore.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ignore-'));
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });

const userConfig = {
  ignoreFiles: ['../outside.txt']
};

const result = await buildIgnoreMatcher({ root: tempRoot, userConfig });
assert.ok(result.warnings.length > 0, 'expected warnings for outside-root ignore');
assert.ok(result.warnings.some((warning) => warning.type === 'outside-root'), 'expected outside-root warning');
assert.ok(!result.ignoreFiles.includes('../outside.txt'), 'outside ignore file should not be loaded');

console.log('ignore path safety test passed');
