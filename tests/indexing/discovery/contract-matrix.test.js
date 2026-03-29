#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { discoverFiles, discoverFilesForModes } from '../../../src/index/build/discover.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { gitProvider } from '../../../src/index/scm/providers/git.js';
import { repoRoot } from '../../helpers/root.js';
import { skip } from '../../helpers/skip.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = repoRoot();
const tempRoot = resolveTestCachePath(root, 'discover-contract-matrix');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'src', 'site'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'docs', 'reference'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'src', 'deep', 'nested'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'logs'), { recursive: true });
await fs.mkdir(path.join(tempRoot, '..config'), { recursive: true });

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
await fs.writeFile(path.join(tempRoot, 'src', ' spaced.js'), 'console.log("hi")\n');
await fs.writeFile(path.join(tempRoot, 'src', 'lib.rs'), 'fn main() {}\n');
await fs.writeFile(path.join(tempRoot, 'src', 'site', 'index.html'), '<!doctype html><html><body>code-ish</body></html>\n');
await fs.writeFile(path.join(tempRoot, 'src', 'deep', 'nested', 'too-deep.js'), 'console.log("deep")\n');
await fs.writeFile(path.join(tempRoot, 'docs', 'readme.md'), '# Hello\n');
await fs.writeFile(path.join(tempRoot, 'docs', 'reference', 'index.html'), '<!doctype html><html><body>docs prose</body></html>\n');
await fs.writeFile(path.join(tempRoot, 'docs', 'reference', 'site.js'), 'console.log("docs script")\n');
await fs.writeFile(path.join(tempRoot, 'docs', 'reference', 'search.json'), '{"hits":[{"title":"docs"}]}\n');
await fs.writeFile(path.join(tempRoot, 'docs', 'reference', 'site.css'), '.docs { color: #000; }\n');
await fs.writeFile(path.join(tempRoot, 'logs', 'app.log'), '2024-01-01 12:00:00 started\n');
await fs.writeFile(path.join(tempRoot, '..config', 'hooks.js'), 'export const hook = true;\n');
await fs.writeFile(path.join(tempRoot, 'Dockerfile.dev'), 'FROM node:20\n');
await fs.writeFile(path.join(tempRoot, 'Makefile.in'), 'build:\n\t@echo ok\n');
runGit(['add', '.']);
runGit(['commit', '-m', 'init']);

await fs.writeFile(path.join(tempRoot, 'src', 'untracked.js'), 'console.log("no")\n');

const { ignoreMatcher } = await buildIgnoreMatcher({ root: tempRoot, userConfig: {} });

const entries = await discoverFiles({
  root: tempRoot,
  mode: 'code',
  scmProvider: 'git',
  scmProviderImpl: gitProvider,
  scmRepoRoot: tempRoot,
  ignoreMatcher,
  skippedFiles: [],
  maxFileBytes: null
});
const rels = entries.map((entry) => entry.rel);
assert.ok(rels.includes('src/app.js'));
assert.ok(rels.includes('src/ spaced.js'), 'expected leading-space filename to be preserved');
assert.ok(rels.includes('..config/hooks.js'));
assert.ok(rels.includes('Dockerfile.dev'));
assert.ok(rels.includes('Makefile.in'));
assert.ok(!rels.includes('src/untracked.js'));
assert.ok(entries[0].stat && typeof entries[0].stat.size === 'number');

const fallbackEntries = await discoverFiles({
  root: tempRoot,
  mode: 'code',
  scmProvider: 'git',
  scmProviderImpl: {
    async listTrackedFiles() {
      return { ok: false, reason: 'unavailable' };
    }
  },
  scmRepoRoot: tempRoot,
  ignoreMatcher,
  skippedFiles: [],
  maxFileBytes: null
});
assert.ok(fallbackEntries.map((entry) => entry.rel).includes('src/untracked.js'));

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
assert.ok(!depthLimited.some((entry) => entry.rel.includes('deep/nested')));
assert.ok(depthSkipped.some((entry) => entry.reason === 'max-depth'));

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
assert.ok(countLimited.length <= 1);
assert.ok(countSkipped.some((entry) => entry.reason === 'max_files_reached'));

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
assert.ok(byMode.code.some((entry) => entry.rel === 'src/app.js'));
assert.ok(byMode.code.some((entry) => entry.rel === '..config/hooks.js'));
assert.ok(byMode.code.some((entry) => entry.rel === 'src/lib.rs'));
assert.ok(byMode.code.some((entry) => entry.rel === 'src/site/index.html'));
assert.ok(byMode.prose.some((entry) => entry.rel === 'docs/readme.md'));
assert.ok(byMode.prose.some((entry) => entry.rel === 'docs/reference/index.html'));
assert.ok(byMode.prose.some((entry) => entry.rel === 'docs/reference/site.js'));
assert.ok(byMode.prose.some((entry) => entry.rel === 'docs/reference/search.json'));
assert.ok(byMode.prose.some((entry) => entry.rel === 'docs/reference/site.css'));
assert.ok(byMode['extracted-prose'].some((entry) => entry.rel === 'src/app.js'));
assert.ok(byMode['extracted-prose'].some((entry) => entry.rel === '..config/hooks.js'));
assert.ok(byMode['extracted-prose'].some((entry) => entry.rel === 'docs/readme.md'));
assert.ok(byMode['extracted-prose'].some((entry) => entry.rel === 'docs/reference/index.html'));
assert.ok(byMode['extracted-prose'].some((entry) => entry.rel === 'docs/reference/site.js'));
assert.ok(byMode['extracted-prose'].some((entry) => entry.rel === 'docs/reference/search.json'));
assert.ok(byMode['extracted-prose'].some((entry) => entry.rel === 'docs/reference/site.css'));
assert.ok(byMode.records.some((entry) => entry.rel === 'logs/app.log'));
assert.ok(!byMode.prose.some((entry) => entry.rel === 'src/lib.rs'));
assert.ok(!byMode.code.some((entry) => entry.rel === 'logs/app.log'));
assert.ok(!byMode.code.some((entry) => entry.rel === 'docs/reference/index.html'));
assert.ok(!byMode.code.some((entry) => entry.rel === 'docs/reference/site.js'));
assert.ok(!byMode.code.some((entry) => entry.rel === 'docs/reference/search.json'));
assert.ok(!byMode.code.some((entry) => entry.rel === 'docs/reference/site.css'));
assert.ok(!byMode.prose.some((entry) => entry.rel === 'logs/app.log'));
assert.ok(!byMode['extracted-prose'].some((entry) => entry.rel === 'logs/app.log'));
assert.ok(!byMode.code.some((entry) => entry.rel === 'src/untracked.js'));
assert.ok(byMode.code.every((entry) => entry.stat));
assert.ok(byMode.prose.every((entry) => entry.stat));
assert.ok(byMode['extracted-prose'].every((entry) => entry.stat));
assert.ok(byMode.records.every((entry) => entry.stat));

console.log('indexing discovery contract matrix test passed');
