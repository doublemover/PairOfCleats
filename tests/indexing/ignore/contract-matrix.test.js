#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ignore from 'ignore';

import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { discoverFiles } from '../../../src/index/build/discover.js';
import { buildIgnoredMatcher } from '../../../src/shared/fs/ignore.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'ignore-contract-matrix');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

{
  const matcherRoot = path.join(os.tmpdir(), 'poc-ignore-matcher');
  const ignoreMatcher = ignore().add(['ignored/', 'only.txt']);
  const isIgnored = buildIgnoredMatcher({ root: matcherRoot, ignoreMatcher });
  const dirStats = { isDirectory: () => true };
  const fileStats = { isDirectory: () => false };
  const ignoredDir = path.join(matcherRoot, 'ignored');
  const ignoredFile = path.join(matcherRoot, 'ignored', 'nested.js');
  const loneFile = path.join(matcherRoot, 'only.txt');
  assert.equal(isIgnored(ignoredDir, dirStats), true);
  assert.equal(isIgnored(ignoredFile, fileStats), true);
  assert.equal(isIgnored(loneFile, fileStats), true);
  assert.equal(isIgnored(path.join(matcherRoot, 'other.txt'), fileStats), false);
  if (path.sep === '\\') {
    assert.equal(isIgnored(ignoredFile.replace(/\//g, '\\'), fileStats), true);
  }
}

{
  const caseRoot = path.join(tempRoot, 'optional-defaults');
  await fs.mkdir(caseRoot, { recursive: true });
  const withoutDefaultFiles = await buildIgnoreMatcher({
    root: caseRoot,
    userConfig: {
      useGitignore: true,
      usePairofcleatsIgnore: true
    }
  });
  assert.equal(withoutDefaultFiles.warnings.some((warning) => warning.type === 'read-failed'), false);

  const explicitMissing = await buildIgnoreMatcher({
    root: caseRoot,
    userConfig: {
      ignoreFiles: ['missing.ignore']
    }
  });
  assert.equal(
    explicitMissing.warnings.some((warning) => warning.type === 'read-failed' && warning.file === 'missing.ignore'),
    true
  );
}

{
  const caseRoot = path.join(tempRoot, 'path-safety');
  await fs.mkdir(path.join(caseRoot, 'src'), { recursive: true });
  const result = await buildIgnoreMatcher({ root: caseRoot, userConfig: { ignoreFiles: ['../outside.txt'] } });
  assert.ok(result.warnings.some((warning) => warning.type === 'outside-root'));
  assert.ok(!result.ignoreFiles.includes('../outside.txt'));

  const outsideDir = path.join(path.dirname(caseRoot), `${path.basename(caseRoot)}-outside-ignore-dir`);
  await fs.mkdir(outsideDir, { recursive: true });
  await fs.writeFile(path.join(outsideDir, 'rules.ignore'), 'node_modules/\n', 'utf8');
  const linkedDir = path.join(caseRoot, 'linked-ignore-dir');
  let linkedDirCreated = false;
  try {
    await fs.symlink(outsideDir, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');
    linkedDirCreated = true;
  } catch {}
  if (linkedDirCreated) {
    const viaLink = await buildIgnoreMatcher({
      root: caseRoot,
      userConfig: { ignoreFiles: ['linked-ignore-dir/rules.ignore'] }
    });
    assert.ok(viaLink.warnings.some((warning) => warning.type === 'outside-root'));
    assert.ok(!viaLink.ignoreFiles.includes('linked-ignore-dir/rules.ignore'));
  }
}

{
  const caseRoot = path.join(tempRoot, 'discovery');
  await fs.mkdir(path.join(caseRoot, 'dist'), { recursive: true });
  await fs.writeFile(path.join(caseRoot, '.gitignore'), 'dist/**\n!dist/allow.js\n', 'utf8');
  await fs.writeFile(path.join(caseRoot, 'dist', 'allow.js'), 'console.log("ok")\n', 'utf8');
  await fs.writeFile(path.join(caseRoot, 'dist', 'deny.js'), 'console.log("no")\n', 'utf8');

  const fileOverride = await buildIgnoreMatcher({ root: caseRoot, userConfig: {} });
  const fileEntries = await discoverFiles({
    root: caseRoot,
    mode: 'code',
    ignoreMatcher: fileOverride.ignoreMatcher,
    skippedFiles: [],
    maxFileBytes: null
  });
  const fileRels = fileEntries.map((entry) => entry.rel).sort();
  assert.equal(fileRels.includes('dist/allow.js'), true);
  assert.equal(fileRels.includes('dist/deny.js'), false);

  const overrideEntries = await discoverFiles({
    root: caseRoot,
    mode: 'code',
    ignoreMatcher: (await buildIgnoreMatcher({
      root: caseRoot,
      userConfig: { extraIgnore: ['!dist/allow.js'] }
    })).ignoreMatcher,
    skippedFiles: [],
    maxFileBytes: null
  });
  const overrideRels = overrideEntries.map((entry) => entry.rel).sort();
  assert.equal(overrideRels.includes('dist/allow.js'), true);
  assert.equal(overrideRels.includes('dist/deny.js'), false);
}

console.log('ignore contract matrix test passed');
