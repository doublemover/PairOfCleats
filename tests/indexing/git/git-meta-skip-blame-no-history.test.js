#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getGitMetaForFile } from '../../../src/index/git.js';
import { setScmCommandRunner } from '../../../src/index/scm/runner.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const target = path.join(root, 'README.md');

if (!fs.existsSync(target)) {
  console.error(`Missing README.md at ${target}`);
  process.exit(1);
}

let logCalls = 0;
let blameCalls = 0;

setScmCommandRunner(async (_command, args) => {
  const argv = Array.isArray(args) ? args : [];
  if (argv.includes('--format=%aI%x00%an')) {
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
});

try {
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
} finally {
  setScmCommandRunner(null);
}

console.log('git no-history blame skip test passed');
