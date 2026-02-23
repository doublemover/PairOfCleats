#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../../helpers/temp.js';
import { summaryReportFixtureInternals } from './summary-report-helpers.js';

const tempRoot = await makeTempDir('pairofcleats-summary-lock-recovery-');
const lockPath = path.join(tempRoot, 'summary-report.lock');

try {
  await fsPromises.writeFile(lockPath, 'stale-lock');
  await new Promise((resolve) => setTimeout(resolve, 12));

  const lockHandle = await summaryReportFixtureInternals.tryAcquireSummaryLock({
    lockPath,
    staleMs: 1
  });
  assert.ok(lockHandle, 'expected stale lock to be evicted and reacquired');
  await lockHandle.close();
  await fsPromises.rm(lockPath, { force: true });
  console.log('summary report stale lock recovery test passed');
} finally {
  await rmDirRecursive(tempRoot);
}
