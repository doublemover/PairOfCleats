#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { gitProvider } from '../../../src/index/scm/providers/git.js';
import { getScmRuntimeConfig, setScmRuntimeConfig } from '../../../src/index/scm/runtime.js';
import { getScmCommandRunner, setScmCommandRunner } from '../../../src/index/scm/runner.js';
import { completeScmFixtureOutput } from '../../helpers/scm-output.js';

const defaultRunner = getScmCommandRunner();
const defaultScmConfig = getScmRuntimeConfig();
const calls = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let inFlight = 0;
let maxInFlight = 0;
let trackedOutput = 'src/a.js\0src/b.js\0';

try {
  setScmRuntimeConfig({ maxConcurrentProcesses: 2 });
  setScmCommandRunner(async (command, args) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      calls.push({ command, args });
      await sleep(25);
      if (args.includes('ls-files')) {
        return completeScmFixtureOutput(trackedOutput);
      }
      if (args.includes('diff')) {
        assert.ok(args.includes('-z'), 'changed-file output preserves exact Git NUL-delimited paths');
        return completeScmFixtureOutput('src/c.js\0src/d.js\0');
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    } finally {
      inFlight -= 1;
    }
  });

  const repoRoot = path.resolve('tests/fixtures/scm/jj');
  const listResult = await gitProvider.listTrackedFiles({ repoRoot, subdir: 'src' });
  assert.deepEqual(listResult.filesPosix, ['src/a.js', 'src/b.js']);
  trackedOutput = 'src\\a.js\0src/b.js\0';
  const literalResult = await gitProvider.listTrackedFiles({ repoRoot });
  assert.deepEqual(literalResult.filesPosix, process.platform === 'win32'
    ? ['src/a.js', 'src/b.js'] : ['src/b.js', 'src\\a.js'], 'NUL-delimited POSIX filename bytes remain distinct');
  trackedOutput = 'src/a.js\0src/b.js\0';

  const diffResult = await gitProvider.getChangedFiles({
    repoRoot,
    fromRef: 'HEAD~1',
    toRef: 'HEAD',
    subdir: 'src'
  });
  assert.deepEqual(diffResult.filesPosix, ['src/c.js', 'src/d.js']);
  await Promise.all(
    Array.from({ length: 6 }, () => gitProvider.listTrackedFiles({ repoRoot, subdir: 'src' }))
  );
  assert(
    maxInFlight <= 2,
    `expected git provider queue to cap concurrency at 2; observed ${maxInFlight}`
  );
  assert(calls.some((entry) => entry.command === 'git'));
} finally {
  setScmCommandRunner(defaultRunner);
  setScmRuntimeConfig(defaultScmConfig);
}

console.log('git provider parse ok');
