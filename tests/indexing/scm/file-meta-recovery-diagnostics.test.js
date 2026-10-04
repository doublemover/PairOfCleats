#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertScmProvider } from '../../../src/index/scm/provider.js';
import { gitProvider } from '../../../src/index/scm/providers/git.js';
import { prepareScmFileMetaSnapshot } from '../../../src/index/scm/file-meta-snapshot.js';
import { normalizeScmMetadataDiagnostics, buildScmMetadataObservation } from '../../../src/index/scm/metadata-diagnostics.js';
import { getScmCommandRunner, setScmCommandRunner } from '../../../src/index/scm/runner.js';
import { getScmRuntimeConfig, setScmRuntimeConfig } from '../../../src/index/scm/runtime.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), `scm-recovery-diagnostics-${process.pid}-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const metadata = { lastCommitId: 'fixture-commit', lastAuthor: 'Fixture Author', lastModifiedAt: '2026-01-01T00:00:00Z' };
const files = ['a.js', 'b.js'];
const input = { repoRoot: root, provider: 'git', filesPosix: files, includeChurn: false,
  repoProvenance: { head: { commitId: 'fixture-head' }, dirty: false }, maxFallbackConcurrency: 1 };
const priorRunner = getScmCommandRunner();
const priorConfig = getScmRuntimeConfig();
const logs = [];
try {
  const partialProvider = assertScmProvider({ ...gitProvider,
    async getFileMetaBatch() { return { fileMetaByPath: { 'a.js': metadata }, diagnostics: { timeoutCount: 2 } }; },
    async getFileMeta() { throw Object.assign(new Error('Fixture missing metadata Bearer inert-secret'), { code: 'FIXTURE_UNAVAILABLE' }); }
  });
  const partial = await prepareScmFileMetaSnapshot({ ...input, providerImpl: partialProvider,
    repoCacheRoot: path.join(root, 'partial'), log: (line) => logs.push(line) });
  assert.equal(partial.stats.timeoutCount, 2, 'provider normalization retains actual batch counters');
  assert.equal(partial.stats.perFileDiagnostics.attempted, 1, 'omitted batch paths are attempted individually');
  assert.equal(partial.stats.unresolvedFiles, 1);
  assert.equal(partial.stats.perFileDiagnostics.failures[0].code, 'FIXTURE_UNAVAILABLE');
  assert.ok(!JSON.stringify(partial).includes('inert-secret'));
  assert.ok(logs.some((line) => line.includes('unresolved=1')));

  const unsupported = assertScmProvider({ ...gitProvider,
    async getFileMetaBatch() { return { ok: false, reason: 'unsupported' }; }, async getFileMeta() { return metadata; } });
  const recovered = await prepareScmFileMetaSnapshot({ ...input, providerImpl: unsupported, repoCacheRoot: path.join(root, 'recovered') });
  assert.equal(recovered.stats.source, 'fresh', 'a fully recovered intentionally unsupported batch path is healthy');
  assert.equal(recovered.stats.batchReason, 'unsupported');
  assert.equal(recovered.stats.perFileDiagnostics.complete, 2);
  assert.equal(recovered.stats.unresolvedFiles, 0);

  const broken = assertScmProvider({ ...gitProvider,
    async getFileMetaBatch() { throw new ReferenceError('Fixture helper is not defined'); }, async getFileMeta() { return metadata; } });
  const failedBatch = await prepareScmFileMetaSnapshot({ ...input, providerImpl: broken, repoCacheRoot: path.join(root, 'broken') });
  assert.equal(failedBatch.stats.batchFailure.code, 'ReferenceError');
  assert.equal(failedBatch.stats.batchFailure.message, 'Fixture helper is not defined');
  assert.equal(failedBatch.stats.source, 'fallback', 'an actual failed batch remains explicit even when per-file work recovers');
  const retained = buildScmMetadataObservation(failedBatch.stats);
  assert.equal(retained.batchFailure.code, 'ReferenceError');
  assert.equal(retained.perFile.complete, 2);
  assert.equal(retained.unresolvedFiles, 0);
  assert.equal('reuse' in retained, false, 'timing evidence does not duplicate a complete reuse ledger');

  setScmRuntimeConfig({ repoRoot: root, repoHeadId: 'a'.repeat(40), maxConcurrentProcesses: 1 });
  setScmCommandRunner(() => ({ exitCode: 128, stdout: '', stderr: 'fatal: fixture repository unavailable' }));
  const failedGit = await assertScmProvider(gitProvider).getFileMetaBatch({ repoRoot: root, headId: 'a'.repeat(40),
    filesPosix: files, includeChurn: false, timeoutMs: 1000 });
  assert.equal(failedGit.failure.code, 'GIT_EXIT_128', 'the Git command failure survives prefetch and provider wrappers');
  assert.equal(failedGit.diagnostics.failureCount, 1);
  assert.match(failedGit.failure.message, /fixture repository unavailable/);
  const bounded = normalizeScmMetadataDiagnostics({ failures: Array.from({ length: 100 }, () => ({ message: 'x'.repeat(1000) })),
    timeoutHeatmap: Array.from({ length: 100 }, () => ({ file: 'x'.repeat(1000), timeouts: 1 })) });
  assert.equal(bounded.failures.length, 8);
  assert.equal(bounded.timeoutHeatmap.length, 32);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.failures[0].message.length, 384);
  console.log('SCM causes/counters survive wrappers; omitted paths are recovered, unsupported recovery is healthy, and retained details stay bounded.');
} finally {
  setScmCommandRunner(priorRunner);
  setScmRuntimeConfig(priorConfig);
  await fs.rm(root, { recursive: true, force: true });
}
