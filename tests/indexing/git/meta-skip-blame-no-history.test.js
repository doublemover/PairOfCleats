#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getGitMetaForFile } from '../../../src/index/git.js';
import { ensureGitMetaReadmeTarget, withScmCommandRunner } from './git-meta-fixture.js';

const { root, target } = ensureGitMetaReadmeTarget();

let logCalls = 0;
let blameCalls = 0;

await withScmCommandRunner(async (_command, args) => {
  const argv = Array.isArray(args) ? args : [];
  if (argv.includes('--format=%H%x00%aI%x00%an') || argv.includes('--format=%aI%x00%an')) {
    logCalls += 1;
    return {
      exitCode: 0,
      stdout: '',
      stderr: ''
    };
  }
  if (argv.includes('blame')) {
    blameCalls += 1;
    return {
      exitCode: 0,
      stdout: '',
      stderr: ''
    };
  }
  return { exitCode: 0, stdout: '', stderr: '' };
}, async () => {
  const meta = await getGitMetaForFile(target, {
    blame: true,
    includeChurn: false,
    baseDir: root,
    timeoutMs: 5
  });
  assert.equal(logCalls, 1, 'expected metadata log command to run once');
  assert.equal(blameCalls, 0, 'expected blame command to be skipped for no-history files');
  assert.equal(meta.last_modified, null, 'expected no-history file to have null last_modified');
  assert.equal(meta.last_author, null, 'expected no-history file to have null last_author');
  assert.equal(Object.hasOwn(meta, 'lineAuthors'), false, 'expected no lineAuthors when blame is skipped');
});

console.log('git no-history blame skip test passed');
