#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { createBenchLanguageLogFixture } from './language-log-fixture.js';

const { logger, masterLogPath, reposRoot } = await createBenchLanguageLogFixture('run-log-emergency-close');

logger.initMasterLog();
const repoLogPath = await logger.initRepoLog({
  label: 'owner/repo-emergency',
  tier: 'small',
  repoPath: path.join(reposRoot, 'repo-emergency'),
  slug: 'repo-emergency'
});
logger.writeLog('[test] emergency close line');
logger.closeLogsSync();

const [masterText, repoText] = await Promise.all([
  fsPromises.readFile(masterLogPath, 'utf8'),
  fsPromises.readFile(repoLogPath, 'utf8')
]);
assert.match(masterText, /\[test\] emergency close line/, 'expected emergency close to preserve master log line');
assert.match(repoText, /\[test\] emergency close line/, 'expected emergency close to preserve repo log line');

console.log('bench language log emergency close test passed');
