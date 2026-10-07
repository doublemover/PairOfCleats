#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { createBenchLanguageLogFixture } from './language-log-fixture.js';

const { logger, masterLogPath, reposRoot } = await createBenchLanguageLogFixture('run-log-closeout');

const {
  initMasterLog,
  initRepoLog,
  flushLogs,
  writeLog,
  closeRepoLog,
  closeMasterLog,
  getRepoLogPath
} = logger;

initMasterLog();
writeLog('[test] before repo');
const firstRepoLog = await initRepoLog({
  label: 'owner/repo-one',
  tier: 'small',
  repoPath: path.join(reposRoot, 'repo-one'),
  slug: 'repo-one'
});
writeLog('[test] repo one line');
await flushLogs();
const firstRepoTextMidRun = await fsPromises.readFile(firstRepoLog, 'utf8');
assert.match(firstRepoTextMidRun, /\[test\] repo one line/, 'repo one log should be inspectable before rotation');

const secondRepoLog = await initRepoLog({
  label: 'owner/repo-two',
  tier: 'small',
  repoPath: path.join(reposRoot, 'repo-two'),
  slug: 'repo-two'
});
writeLog('[test] repo two final line');
await flushLogs();

assert.ok(firstRepoLog && secondRepoLog, 'expected repo log paths');
assert.notEqual(firstRepoLog, secondRepoLog, 'expected unique per-repo log paths');

await closeRepoLog();
assert.equal(getRepoLogPath(), null, 'expected repo log path cleared after close');
await closeMasterLog();

const [masterText, firstRepoText, secondRepoText] = await Promise.all([
  fsPromises.readFile(masterLogPath, 'utf8'),
  fsPromises.readFile(firstRepoLog, 'utf8'),
  fsPromises.readFile(secondRepoLog, 'utf8')
]);
assert.match(masterText, /\[test\] repo one line/, 'master log missing repo one line');
assert.match(masterText, /\[test\] repo two final line/, 'master log missing repo two line');
assert.match(firstRepoText, /\[test\] repo one line/, 'repo one log missing expected line');
assert.doesNotMatch(firstRepoText, /\[test\] repo two final line/, 'repo one log should not contain repo two line');
assert.match(secondRepoText, /\[test\] repo two final line/, 'repo two log missing expected line');

console.log('bench-language log closeout test passed');
