#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildBenchRunSummaryFromLedgerEvents } from '../../../tools/bench/language-repos/run-ledger.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-run-ledger-summary');
const diagnosticsRoot = path.join(tempRoot, 'diagnostics');
const bundleDir = path.join(diagnosticsRoot, 'owner__repo-two');
const bundlePath = path.join(bundleDir, 'retained-crash-bundle.json');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });
await fs.writeFile(bundlePath, JSON.stringify({ ok: true }, null, 2));

const events = [
  {
    schemaVersion: 1,
    eventVersion: 1,
    ts: '2026-03-21T12:00:00.000Z',
    eventType: 'run.started',
    payload: {
      runSuffix: 'run-ledger-fixture',
      plannedRepoCount: 2,
      taskCount: 2,
      masterLogPath: path.join(tempRoot, 'run-all.log'),
      ledgerPath: path.join(tempRoot, 'run-ledger.jsonl'),
      summaryPath: path.join(tempRoot, 'run-summary.json'),
      footerPath: path.join(tempRoot, 'run-footer.log'),
      diagnosticsRoot
    }
  },
  {
    schemaVersion: 1,
    eventVersion: 1,
    ts: '2026-03-21T12:00:01.000Z',
    eventType: 'repo.started',
    payload: { language: 'javascript', tier: 'small', repo: 'owner/repo-one' }
  },
  {
    schemaVersion: 1,
    eventVersion: 1,
    ts: '2026-03-21T12:00:02.000Z',
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
        diagnostics: {
          process: {
            countsByType: {
              fallback_used: 2
            }
          }
        }
      }
    }
  },
  {
    schemaVersion: 1,
    eventVersion: 1,
    ts: '2026-03-21T12:00:03.000Z',
    eventType: 'repo.started',
    payload: { language: 'go', tier: 'large', repo: 'owner/repo-two' }
  },
  {
    schemaVersion: 1,
    eventVersion: 1,
    ts: '2026-03-21T12:00:04.000Z',
    eventType: 'repo.completed',
    payload: {
      result: {
        language: 'go',
        tier: 'large',
        repo: 'owner/repo-two',
        repoPath: 'C:\\repo-two',
        outFile: 'C:\\repo-two.json',
        failed: true,
        skipped: false,
        failureReason: 'bench',
        failureCode: 1,
        diagnostics: {
          process: {
            countsByType: {
              artifact_tail_stall: 1
            }
          },
          crashRetention: {
            bundlePath,
            diagnosticsDir: bundleDir
          }
        }
      }
    }
  },
  {
    schemaVersion: 1,
    eventVersion: 1,
    ts: '2026-03-21T12:00:05.000Z',
    eventType: 'closeout.started',
    payload: { state: 'completed' }
  },
  {
    schemaVersion: 1,
    eventVersion: 1,
    ts: '2026-03-21T12:00:06.000Z',
    eventType: 'closeout.summary_written',
    payload: {}
  },
  {
    schemaVersion: 1,
    eventVersion: 1,
    ts: '2026-03-21T12:00:07.000Z',
    eventType: 'closeout.footer_written',
    payload: {}
  },
  {
    schemaVersion: 1,
    eventVersion: 1,
    ts: '2026-03-21T12:00:08.000Z',
    eventType: 'run.ended',
    payload: {
      state: 'completed',
      reason: 'completed',
      exitCode: 1
    }
  }
];

const summary = await buildBenchRunSummaryFromLedgerEvents({
  events,
  diagnosticsRoot,
  runSuffix: 'run-ledger-fixture'
});

assert.equal(summary.run.state, 'completed', 'expected completed run state');
assert.equal(summary.counts.planned, 2, 'expected planned repo count');
assert.equal(summary.counts.finished, 2, 'expected finished repo count');
assert.equal(summary.counts.unfinished, 0, 'expected no unfinished repos');
assert.equal(summary.verdict.aggregateResultClass, 'repo_failed', 'expected repo_failed verdict');
assert.equal(summary.parities.crashRetention.ledgerCount, 1, 'expected one ledger crash bundle');
assert.equal(summary.parities.crashRetention.directoryCount, 1, 'expected one retained crash bundle on disk');
assert.equal(summary.parities.crashRetention.ok, true, 'expected crash-retention parity');
assert.equal(summary.closeout.closeoutStarted, true, 'expected closeout started marker');
assert.equal(summary.closeout.closeoutSummaryWritten, true, 'expected closeout summary marker');
assert.equal(summary.closeout.closeoutFooterWritten, true, 'expected closeout footer marker');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('bench language run ledger summary test passed');
