#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildBenchRunSummaryFromLedgerEvents, formatBenchRunFooter } from '../../../tools/bench/language-repos/run-ledger.js';

const events = [
  {
    schemaVersion: 1,
    eventVersion: 1,
    ts: '2026-03-21T12:10:00.000Z',
    eventType: 'run.started',
    payload: {
      runSuffix: 'run-interrupted-fixture',
      plannedRepoCount: 2,
      taskCount: 2
    }
  },
  {
    schemaVersion: 1,
    eventVersion: 1,
    ts: '2026-03-21T12:10:01.000Z',
    eventType: 'repo.started',
    payload: {
      language: 'javascript',
      tier: 'small',
      repo: 'owner/repo-one',
      repoPath: 'C:\\repo-one'
    }
  },
  {
    schemaVersion: 1,
    eventVersion: 1,
    ts: '2026-03-21T12:10:02.000Z',
    eventType: 'repo.completed',
    payload: {
      result: {
        language: 'javascript',
        tier: 'small',
        repo: 'owner/repo-one',
        repoPath: 'C:\\repo-one',
        outFile: 'C:\\repo-one.json',
        failed: false,
        skipped: false,
        diagnostics: {}
      }
    }
  },
  {
    schemaVersion: 1,
    eventVersion: 1,
    ts: '2026-03-21T12:10:03.000Z',
    eventType: 'repo.started',
    payload: {
      language: 'go',
      tier: 'large',
      repo: 'owner/repo-two',
      repoPath: 'C:\\repo-two'
    }
  },
  {
    schemaVersion: 1,
    eventVersion: 1,
    ts: '2026-03-21T12:10:04.000Z',
    eventType: 'closeout.started',
    payload: {
      state: 'interrupted',
      reason: 'SIGINT'
    }
  },
  {
    schemaVersion: 1,
    eventVersion: 1,
    ts: '2026-03-21T12:10:05.000Z',
    eventType: 'run.ended',
    payload: {
      state: 'interrupted',
      reason: 'SIGINT',
      signal: 'SIGINT',
      exitCode: 130
    }
  }
];

const summary = await buildBenchRunSummaryFromLedgerEvents({
  events,
  diagnosticsRoot: null,
  runSuffix: 'run-interrupted-fixture'
});
const footerLines = formatBenchRunFooter(summary);

assert.equal(summary.run.state, 'interrupted', 'expected interrupted state');
assert.equal(summary.run.reason, 'SIGINT', 'expected SIGINT reason');
assert.equal(summary.counts.planned, 2, 'expected planned count');
assert.equal(summary.counts.finished, 1, 'expected one finished repo');
assert.equal(summary.counts.unfinished, 1, 'expected one unfinished repo');
assert.equal(summary.unfinishedRepos.length, 1, 'expected unfinished repo listing');
assert.equal(summary.unfinishedRepos[0].repo, 'owner/repo-two', 'expected second repo to remain unfinished');
assert.equal(
  footerLines.some((line) => line.includes('State: interrupted')),
  true,
  'expected interrupted footer line'
);

console.log('bench-language interrupted closeout test passed');
