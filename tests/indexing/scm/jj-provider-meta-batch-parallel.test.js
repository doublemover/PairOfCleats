#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { jjProvider } from '../../../src/index/scm/providers/jj.js';
import { getScmRuntimeConfig, setScmRuntimeConfig } from '../../../src/index/scm/runtime.js';
import { getScmCommandRunner, setScmCommandRunner } from '../../../src/index/scm/runner.js';

const defaultRunner = getScmCommandRunner();
const defaultScmConfig = getScmRuntimeConfig();
const repoRoot = path.resolve('C:/repo');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let inFlight = 0;
let maxInFlight = 0;
let metaLogCalls = 0;

const parseFileFromFilesetArg = (value) => {
  const raw = String(value || '');
  const match = raw.match(/^root-file:"(.+)"$/);
  if (!match) return null;
  return match[1]
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
};

try {
  setScmRuntimeConfig({
    maxConcurrentProcesses: 6,
    timeoutMs: 4000,
    runtime: {
      fileConcurrency: 6,
      cpuConcurrency: 6
    },
    jj: {
      snapshotWorkingCopy: false
    }
  });
  setScmCommandRunner(async (command, args) => {
    assert.equal(command, 'jj');
    if (!Array.isArray(args)) return { exitCode: 1, stdout: '', stderr: 'invalid args' };
    if (args.includes('--version')) {
      return { exitCode: 0, stdout: 'jj 0.20.0', stderr: '' };
    }
    if (args.includes('log')) {
      const filesetArg = args[args.length - 1];
      const filePosix = parseFileFromFilesetArg(filesetArg);
      if (filePosix) {
        metaLogCalls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          await sleep(20);
          return {
            exitCode: 0,
            stdout: `${JSON.stringify({
              commit_id: `jjc-${metaLogCalls}`,
              author: 'Jess',
              timestamp: '2026-02-23T00:00:00Z',
              added: 3,
              removed: 2
            })}\n`,
            stderr: ''
          };
        } finally {
          inFlight -= 1;
        }
      }
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  });

  const files = Array.from({ length: 72 }, (_unused, index) => `src/parallel-${index}.js`);
  const first = await jjProvider.getFileMetaBatch({
    repoRoot,
    filesPosix: files,
    timeoutMs: 5000,
    includeChurn: true,
    headId: 'head-1'
  });
  assert.ok(first?.fileMetaByPath, 'expected batch metadata response');
  assert.equal(Object.keys(first.fileMetaByPath).length, files.length, 'expected metadata for all files');
  assert(
    maxInFlight > 1,
    `expected parallel JJ metadata fanout; observed max in-flight ${maxInFlight}`
  );
  assert(
    maxInFlight <= 6,
    `expected JJ metadata fanout to respect maxConcurrentProcesses=6; observed ${maxInFlight}`
  );

  metaLogCalls = 0;
  maxInFlight = 0;
  const second = await jjProvider.getFileMetaBatch({
    repoRoot,
    filesPosix: files,
    timeoutMs: 5000,
    includeChurn: true,
    headId: 'head-1'
  });
  assert.ok(second?.fileMetaByPath, 'expected cached batch metadata response');
  assert.equal(Object.keys(second.fileMetaByPath).length, files.length, 'expected cached metadata for all files');
  assert.equal(metaLogCalls, 0, 'expected cached JJ metadata to avoid repeated jj log fanout');

  const third = await jjProvider.getFileMetaBatch({
    repoRoot,
    filesPosix: files,
    timeoutMs: 5000,
    includeChurn: true,
    headId: 'head-2'
  });
  assert.ok(third?.fileMetaByPath, 'expected cache miss batch metadata response');
  assert.equal(Object.keys(third.fileMetaByPath).length, files.length, 'expected metadata for all files after head change');
  assert(
    metaLogCalls > 0,
    'expected new head id to invalidate JJ metadata cache'
  );
} finally {
  setScmCommandRunner(defaultRunner);
  setScmRuntimeConfig(defaultScmConfig);
}

console.log('jj provider file-meta batch parallelism/cache ok');
