#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ignore-'));
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });

const userConfig = {
  ignoreFiles: ['../outside.txt']
};

const result = await buildIgnoreMatcher({ root: tempRoot, userConfig });
assert.ok(result.warnings.length > 0, 'expected warnings for outside-root ignore');
assert.ok(result.warnings.some((warning) => warning.type === 'outside-root'), 'expected outside-root warning');
assert.ok(!result.ignoreFiles.includes('../outside.txt'), 'outside ignore file should not be loaded');

const outsideDir = path.join(path.dirname(tempRoot), `${path.basename(tempRoot)}-outside-ignore-dir`);
await fs.mkdir(outsideDir, { recursive: true });
await fs.writeFile(path.join(outsideDir, 'rules.ignore'), 'node_modules/\n', 'utf8');
const linkedDir = path.join(tempRoot, 'linked-ignore-dir');
let linkedDirCreated = false;
try {
  await fs.symlink(outsideDir, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');
  linkedDirCreated = true;
} catch {}
if (linkedDirCreated) {
  const viaLink = await buildIgnoreMatcher({
    root: tempRoot,
    userConfig: { ignoreFiles: ['linked-ignore-dir/rules.ignore'] }
  });
  assert.ok(
    viaLink.warnings.some((warning) => warning.type === 'outside-root'),
    'expected symlinked outside ignore file to be rejected as outside-root'
  );
  assert.ok(
    !viaLink.ignoreFiles.includes('linked-ignore-dir/rules.ignore'),
    'symlinked outside ignore file should not be loaded'
  );
}

console.log('ignore path safety test passed');
