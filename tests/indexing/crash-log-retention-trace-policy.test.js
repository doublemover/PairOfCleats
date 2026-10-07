#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv, withTemporaryEnv } from '../helpers/test-env.js';
import { retainCrashArtifacts } from '../../src/index/build/crash-log.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'crash-log-retention-trace-policy');
const repoCacheRoot = path.join(tempRoot, 'cache', 'repo-cache');
const logsDir = path.join(repoCacheRoot, 'logs');
const diagnosticsRootDefault = path.join(tempRoot, 'results', 'default');
const diagnosticsRootFull = path.join(tempRoot, 'results', 'full');
const tracePath = path.join(logsDir, 'index-crash-file-trace.ndjson');
const traceLines = [];

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(logsDir, { recursive: true });

for (let i = 0; i < 22000; i += 1) {
  traceLines.push(JSON.stringify({
    ts: `2026-03-21T12:00:${String(i % 60).padStart(2, '0')}.000Z`,
    phase: 'processing',
    stage: 'stage1',
    substage: i % 5 === 0 ? 'tree-sitter:error' : 'process-chunks:start',
    file: `src/file-${i % 23}.js`,
    fileIndex: i,
    mode: 'code',
    errorCode: i % 5 === 0 ? 'ERR_SYNTHETIC' : null,
    errorMessage: i % 5 === 0 ? 'synthetic parser crash' : null
  }));
}
await fsPromises.writeFile(tracePath, `${traceLines.join('\n')}\n`, 'utf8');
const sourceBytes = (await fsPromises.stat(tracePath)).size;
assert.ok(sourceBytes > 2 * 1024 * 1024, 'expected trace fixture to exceed default full-copy budget');

const defaultRetention = await retainCrashArtifacts({
  repoCacheRoot,
  diagnosticsRoot: diagnosticsRootDefault,
  repoLabel: 'owner/repo',
  repoSlug: 'owner-repo',
  runId: 'run-default'
});
assert.ok(defaultRetention?.bundlePath, 'expected default crash bundle path');
const defaultBundle = JSON.parse(await fsPromises.readFile(defaultRetention.bundlePath, 'utf8'));
assert.equal(defaultBundle.retentionPolicy.profile, 'default', 'expected default retention profile');
assert.equal(defaultBundle.retentionPolicy.fullTraceEnabled, false, 'expected full trace disabled by default');
assert.equal(
  defaultBundle.copiedArtifacts.some((artifact) => artifact.relativePath === path.join('logs', 'index-crash-file-trace.ndjson')),
  false,
  'expected oversized trace to avoid full-copy retention by default'
);
const defaultTraceDecision = defaultBundle.retentionDecisions.find((entry) => entry.relativePath === path.join('logs', 'index-crash-file-trace.ndjson'));
assert.equal(defaultTraceDecision?.retentionKind, 'summary', 'expected summarized default trace retention');
assert.equal(defaultTraceDecision?.sourceBytes, sourceBytes, 'expected trace decision to capture source bytes');
const defaultSummaryArtifact = defaultTraceDecision?.retainedArtifacts?.[0] || null;
assert.ok(defaultSummaryArtifact?.path, 'expected retained trace summary artifact');
assert.equal(fs.existsSync(defaultSummaryArtifact.path), true, 'expected retained trace summary file on disk');
const defaultSummary = JSON.parse(await fsPromises.readFile(defaultSummaryArtifact.path, 'utf8'));
assert.equal(defaultSummary.kind, 'crash-trace-summary', 'expected crash trace summary payload');
assert.equal(defaultSummary.eventCount, 22000, 'expected full trace event count in summary');
assert.ok(defaultSummary.head.length > 0, 'expected summary head sample');
assert.ok(defaultSummary.tail.length > 0, 'expected summary tail sample');
assert.ok(defaultSummary.topFiles.length > 0, 'expected top file counts in summary');
assert.ok(defaultBundle.retentionPolicy.retainedBytesTotal < sourceBytes, 'expected bounded retained bytes for summarized trace');

const fullRetention = await withTemporaryEnv({ PAIROFCLEATS_CRASH_RETENTION_PROFILE: 'full' }, async () => retainCrashArtifacts({
  repoCacheRoot,
  diagnosticsRoot: diagnosticsRootFull,
  repoLabel: 'owner/repo',
  repoSlug: 'owner-repo',
  runId: 'run-full'
}));
assert.ok(fullRetention?.bundlePath, 'expected full-profile crash bundle path');
const fullBundle = JSON.parse(await fsPromises.readFile(fullRetention.bundlePath, 'utf8'));
assert.equal(fullBundle.retentionPolicy.profile, 'full', 'expected full retention profile');
assert.equal(fullBundle.retentionPolicy.fullTraceEnabled, true, 'expected full trace enabled for full profile');
assert.equal(
  fullBundle.copiedArtifacts.some((artifact) => artifact.relativePath === path.join('logs', 'index-crash-file-trace.ndjson')),
  true,
  'expected full profile to retain the full trace'
);
const fullTraceDecision = fullBundle.retentionDecisions.find((entry) => entry.relativePath === path.join('logs', 'index-crash-file-trace.ndjson'));
assert.equal(fullTraceDecision?.retentionKind, 'full', 'expected full retention decision when full profile is enabled');

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('crash log retention trace policy test passed');
