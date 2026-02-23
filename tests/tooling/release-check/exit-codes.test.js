#!/usr/bin/env node
import { runReleaseCheckCli } from '../../helpers/release-check-fixture.js';

const failed = await runReleaseCheckCli({
  outDirName: 'release-check-exit-codes',
  extraArgs: ['--dry-run-fail-step', 'smoke.fixture-search']
});

if (failed.run.status === 0) {
  console.error('exit-codes test failed: expected non-zero on forced dry-run failure');
  process.exit(1);
}

const passed = await runReleaseCheckCli({
  outDirName: 'release-check-exit-codes'
});

if (passed.run.status !== 0) {
  console.error('exit-codes test failed: expected zero for successful dry-run');
  process.exit(passed.run.status ?? 1);
}

console.log('release-check exit-codes test passed');
