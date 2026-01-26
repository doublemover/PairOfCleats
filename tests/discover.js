import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { discoverFiles, discoverFilesForModes } from '../src/index/build/discover.js';
import { buildIgnoreMatcher } from '../src/index/build/ignore.js';
import { repoRoot } from './helpers/root.js';
import { skip } from './helpers/skip.js';

const root = repoRoot();
const tempRoot = path.join(root, '.testCache', 'discover');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'src', 'deep', 'nested'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'logs'), { recursive: true });

const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (gitCheck.status !== 0) {
  skip('git not available');
}

const runGit = (args) => {
  const result = spawnSync('git', args, { cwd: tempRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
};

runGit(['init']);
runGit(['config', 'user.email', 'tests@example.com']);
runGit(['config', 'user.name', 'Tests']);

await fs.writeFile(path.join(tempRoot, 'src', 'app.js'), 'console.log("hi")\n');
await fs.writeFile(path.join(tempRoot, 'src', 'lib.rs'), 'fn main() {}\n');
await fs.writeFile(path.join(tempRoot, 'src', 'deep', 'nested', 'too-deep.js'), 'console.log("deep")\n');
await fs.writeFile(path.join(tempRoot, 'docs', 'readme.md'), '# Hello\n');
await fs.writeFile(path.join(tempRoot, 'logs', 'app.log'), '2024-01-01 12:00:00 started\n');
await fs.writeFile(path.join(tempRoot, 'Dockerfile.dev'), 'FROM node:20\n');
await fs.writeFile(path.join(tempRoot, 'Makefile.in'), 'build:\n\t@echo ok\n');
runGit(['add', '.']);
runGit(['commit', '-m', 'init']);

await fs.writeFile(path.join(tempRoot, 'src', 'untracked.js'), 'console.log("no")\n');

const { ignoreMatcher } = await buildIgnoreMatcher({ root: tempRoot, userConfig: {} });

const skipped = [];
const codeEntries = await discoverFiles({
  root: tempRoot,
  mode: 'code',
  ignoreMatcher,
  skippedFiles: skipped,
  maxFileBytes: null
});
const codeRel = codeEntries.map((entry) => entry.rel);
assert.ok(codeRel.includes('src/app.js'), 'tracked code file missing');
assert.ok(codeRel.includes('Dockerfile.dev'), 'Dockerfile variant missing');
assert.ok(codeRel.includes('Makefile.in'), 'Makefile variant missing');
assert.ok(!codeRel.includes('src/untracked.js'), 'untracked file should not be discovered');
assert.ok(codeEntries[0].stat && typeof codeEntries[0].stat.size === 'number', 'stat missing');

const depthSkipped = [];
const depthLimited = await discoverFiles({
  root: tempRoot,
  mode: 'code',
  ignoreMatcher,
  skippedFiles: depthSkipped,
  maxFileBytes: null,
  maxDepth: 1
});
assert.ok(!depthLimited.some((entry) => entry.rel.includes('deep/nested')), 'maxDepth should skip deep files');
assert.ok(depthSkipped.some((entry) => entry.reason === 'max-depth'), 'maxDepth skip reason missing');

const countSkipped = [];
const countLimited = await discoverFiles({
  root: tempRoot,
  mode: 'code',
  ignoreMatcher,
  skippedFiles: countSkipped,
  maxFileBytes: null,
  maxFiles: 1
});
assert.ok(countLimited.length <= 1, 'maxFiles should cap entries');
assert.ok(countSkipped.some((entry) => entry.reason === 'max-files'), 'maxFiles skip reason missing');

const skippedByMode = { code: [], prose: [], 'extracted-prose': [], records: [] };
const byMode = await discoverFilesForModes({
  root: tempRoot,
  modes: ['code', 'prose', 'extracted-prose', 'records'],
  ignoreMatcher,
  skippedByMode,
  maxFileBytes: null
});
assert.ok(byMode.code.some((entry) => entry.rel === 'src/app.js'), 'code mode missing app.js');
assert.ok(byMode.code.some((entry) => entry.rel === 'src/lib.rs'), 'code mode missing lib.rs');
assert.ok(byMode.prose.some((entry) => entry.rel === 'docs/readme.md'), 'prose mode missing readme');
assert.ok(byMode['extracted-prose'].some((entry) => entry.rel === 'src/app.js'), 'extracted-prose missing app.js');
assert.ok(byMode['extracted-prose'].some((entry) => entry.rel === 'docs/readme.md'), 'extracted-prose missing readme');
assert.ok(byMode.records.some((entry) => entry.rel === 'logs/app.log'), 'records mode missing app.log');
assert.ok(!byMode.prose.some((entry) => entry.rel === 'src/lib.rs'), 'prose mode should not include Rust files');
assert.ok(!byMode.code.some((entry) => entry.rel === 'logs/app.log'), 'code mode should not include records files');
assert.ok(!byMode.prose.some((entry) => entry.rel === 'logs/app.log'), 'prose mode should not include records files');
assert.ok(!byMode['extracted-prose'].some((entry) => entry.rel === 'logs/app.log'), 'extracted-prose mode should not include records files');
assert.ok(!byMode.code.some((entry) => entry.rel === 'src/untracked.js'), 'untracked file should not appear');
assert.ok(byMode.code.every((entry) => entry.stat), 'code entries missing stat');
assert.ok(byMode.prose.every((entry) => entry.stat), 'prose entries missing stat');
assert.ok(byMode['extracted-prose'].every((entry) => entry.stat), 'extracted-prose entries missing stat');
assert.ok(byMode.records.every((entry) => entry.stat), 'records entries missing stat');

console.log('discover test passed');

