import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { discoverFiles, discoverFilesForModes } from '../../../src/index/build/discover.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { gitProvider } from '../../../src/index/scm/providers/git.js';
import { repoRoot } from '../../helpers/root.js';
import { skip } from '../../helpers/skip.js';

const root = repoRoot();
const tempRoot = path.join(root, '.testCache', 'discover');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'src', 'site'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'docs', 'reference'), { recursive: true });
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
await fs.writeFile(path.join(tempRoot, 'src', 'site', 'index.html'), '<!doctype html><html><body>code-ish</body></html>\n');
await fs.writeFile(path.join(tempRoot, 'src', 'deep', 'nested', 'too-deep.js'), 'console.log("deep")\n');
await fs.writeFile(path.join(tempRoot, 'docs', 'readme.md'), '# Hello\n');
await fs.writeFile(path.join(tempRoot, 'docs', 'reference', 'index.html'), '<!doctype html><html><body>docs prose</body></html>\n');
await fs.writeFile(path.join(tempRoot, 'docs', 'reference', 'site.js'), 'console.log("docs script")\n');
await fs.writeFile(path.join(tempRoot, 'docs', 'reference', 'search.json'), '{"hits":[{"title":"docs"}]}\n');
await fs.writeFile(path.join(tempRoot, 'docs', 'reference', 'site.css'), '.docs { color: #000; }\n');
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
  scmProvider: 'git',
  scmProviderImpl: gitProvider,
  scmRepoRoot: tempRoot,
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

const scmFailureProvider = {
  async listTrackedFiles() {
    return { ok: false, reason: 'unavailable' };
  }
};
const fallbackEntries = await discoverFiles({
  root: tempRoot,
  mode: 'code',
  scmProvider: 'git',
  scmProviderImpl: scmFailureProvider,
  scmRepoRoot: tempRoot,
  ignoreMatcher,
  skippedFiles: [],
  maxFileBytes: null
});
const fallbackRel = fallbackEntries.map((entry) => entry.rel);
assert.ok(fallbackRel.includes('src/untracked.js'), 'fallback discovery should include untracked files');

const depthSkipped = [];
const depthLimited = await discoverFiles({
  root: tempRoot,
  mode: 'code',
  scmProvider: 'git',
  scmProviderImpl: gitProvider,
  scmRepoRoot: tempRoot,
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
  scmProvider: 'git',
  scmProviderImpl: gitProvider,
  scmRepoRoot: tempRoot,
  ignoreMatcher,
  skippedFiles: countSkipped,
  maxFileBytes: null,
  maxFiles: 1
});
assert.ok(countLimited.length <= 1, 'maxFiles should cap entries');
assert.ok(countSkipped.some((entry) => entry.reason === 'max_files_reached'), 'maxFiles skip reason missing');

const skippedByMode = { code: [], prose: [], 'extracted-prose': [], records: [] };
const byMode = await discoverFilesForModes({
  root: tempRoot,
  modes: ['code', 'prose', 'extracted-prose', 'records'],
  scmProvider: 'git',
  scmProviderImpl: gitProvider,
  scmRepoRoot: tempRoot,
  ignoreMatcher,
  skippedByMode,
  maxFileBytes: null
});
assert.ok(byMode.code.some((entry) => entry.rel === 'src/app.js'), 'code mode missing app.js');
assert.ok(byMode.code.some((entry) => entry.rel === 'src/lib.rs'), 'code mode missing lib.rs');
assert.ok(byMode.code.some((entry) => entry.rel === 'src/site/index.html'), 'code mode missing non-docs html');
assert.ok(byMode.prose.some((entry) => entry.rel === 'docs/readme.md'), 'prose mode missing readme');
assert.ok(byMode.prose.some((entry) => entry.rel === 'docs/reference/index.html'), 'prose mode missing docs html');
assert.ok(byMode.prose.some((entry) => entry.rel === 'docs/reference/site.js'), 'prose mode missing docs js');
assert.ok(byMode.prose.some((entry) => entry.rel === 'docs/reference/search.json'), 'prose mode missing docs json');
assert.ok(byMode.prose.some((entry) => entry.rel === 'docs/reference/site.css'), 'prose mode missing docs css');
assert.ok(byMode['extracted-prose'].some((entry) => entry.rel === 'src/app.js'), 'extracted-prose missing app.js');
assert.ok(byMode['extracted-prose'].some((entry) => entry.rel === 'docs/readme.md'), 'extracted-prose missing readme');
assert.ok(byMode['extracted-prose'].some((entry) => entry.rel === 'docs/reference/index.html'), 'extracted-prose missing docs html');
assert.ok(byMode['extracted-prose'].some((entry) => entry.rel === 'docs/reference/site.js'), 'extracted-prose missing docs js');
assert.ok(byMode['extracted-prose'].some((entry) => entry.rel === 'docs/reference/search.json'), 'extracted-prose missing docs json');
assert.ok(byMode['extracted-prose'].some((entry) => entry.rel === 'docs/reference/site.css'), 'extracted-prose missing docs css');
assert.ok(byMode.records.some((entry) => entry.rel === 'logs/app.log'), 'records mode missing app.log');
assert.ok(!byMode.prose.some((entry) => entry.rel === 'src/lib.rs'), 'prose mode should not include Rust files');
assert.ok(!byMode.code.some((entry) => entry.rel === 'logs/app.log'), 'code mode should not include records files');
assert.ok(!byMode.code.some((entry) => entry.rel === 'docs/reference/index.html'), 'code mode should not include docs html');
assert.ok(!byMode.code.some((entry) => entry.rel === 'docs/reference/site.js'), 'code mode should not include docs js');
assert.ok(!byMode.code.some((entry) => entry.rel === 'docs/reference/search.json'), 'code mode should not include docs json');
assert.ok(!byMode.code.some((entry) => entry.rel === 'docs/reference/site.css'), 'code mode should not include docs css');
assert.ok(!byMode.prose.some((entry) => entry.rel === 'logs/app.log'), 'prose mode should not include records files');
assert.ok(!byMode['extracted-prose'].some((entry) => entry.rel === 'logs/app.log'), 'extracted-prose mode should not include records files');
assert.ok(!byMode.code.some((entry) => entry.rel === 'src/untracked.js'), 'untracked file should not appear');
assert.ok(byMode.code.every((entry) => entry.stat), 'code entries missing stat');
assert.ok(byMode.prose.every((entry) => entry.stat), 'prose entries missing stat');
assert.ok(byMode['extracted-prose'].every((entry) => entry.stat), 'extracted-prose entries missing stat');
assert.ok(byMode.records.every((entry) => entry.stat), 'records entries missing stat');

console.log('discover test passed');

