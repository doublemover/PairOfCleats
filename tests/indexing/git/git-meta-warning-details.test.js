#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { prepareScmFileMetaSnapshot } from '../../../src/index/scm/file-meta-snapshot.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const tempRoot = path.join(process.cwd(), '.testCache', 'git-meta-warning-details');
const fallbackRepoRoot = path.join(tempRoot, 'fallback-repo');
const diagnosticsRepoRoot = path.join(tempRoot, 'diagnostics-repo');
const fallbackCacheRoot = path.join(tempRoot, 'fallback-cache');
const diagnosticsCacheRoot = path.join(tempRoot, 'diagnostics-cache');

const writeRepoFiles = (repoRoot, filesPosix) => {
  for (const filePosix of filesPosix) {
    const absPath = path.join(repoRoot, filePosix);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, `// ${filePosix}\n`, 'utf8');
  }
};

const createSimpleMeta = (filePosix, authorPrefix) => ({
  lastCommitId: `commit-${filePosix.replace(/[^a-z0-9]/gi, '')}`,
  lastModifiedAt: '2026-02-22T00:00:00Z',
  lastAuthor: `${authorPrefix}:${filePosix}`,
  churn: null,
  churnAdded: null,
  churnDeleted: null,
  churnCommits: null
});

fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(fallbackRepoRoot, { recursive: true });
fs.mkdirSync(diagnosticsRepoRoot, { recursive: true });
fs.mkdirSync(fallbackCacheRoot, { recursive: true });
fs.mkdirSync(diagnosticsCacheRoot, { recursive: true });

const fallbackFiles = ['src/a.js', 'src/b.js'];
const diagnosticsFiles = ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js'];
writeRepoFiles(fallbackRepoRoot, fallbackFiles);
writeRepoFiles(diagnosticsRepoRoot, diagnosticsFiles);

let batchCalls = 0;
const fallbackFileCalls = [];
const fallbackLogs = [];
const fallbackProviderImpl = {
  async getFileMetaBatch() {
    batchCalls += 1;
    return { ok: false, reason: 'unavailable' };
  },
  async getFileMeta({ filePosix }) {
    fallbackFileCalls.push(String(filePosix || ''));
    return createSimpleMeta(filePosix, 'fallback-author');
  }
};

const diagnosticsLogs = [];
const diagnosticsProviderImpl = {
  async getFileMetaBatch({ filesPosix }) {
    const fileMetaByPath = Object.create(null);
    for (const filePosix of Array.isArray(filesPosix) ? filesPosix : []) {
      fileMetaByPath[filePosix] = createSimpleMeta(filePosix, 'batch-author');
    }
    return {
      fileMetaByPath,
      diagnostics: {
        timeoutCount: 4,
        timeoutRetries: 3,
        cooldownSkips: 2,
        unavailableChunks: 1,
        timeoutHeatmap: [
          { file: 'src/a.js', timeouts: 3, retries: 2, cooldownSkips: 1, lastTimeoutMs: 95 },
          { file: 'src/b.js', timeouts: 2, retries: 1, cooldownSkips: 0, lastTimeoutMs: 90 },
          { file: 'src/c.js', timeouts: 1, retries: 1, cooldownSkips: 1, lastTimeoutMs: 80 },
          { file: 'src/d.js', timeouts: 1, retries: 0, cooldownSkips: 0, lastTimeoutMs: 70 }
        ]
      }
    };
  },
  async getFileMeta() {
    throw new Error('unexpected per-file fallback path for diagnostics scenario');
  }
};

try {
  const fallbackResult = await prepareScmFileMetaSnapshot({
    repoCacheRoot: fallbackCacheRoot,
    provider: 'git',
    providerImpl: fallbackProviderImpl,
    repoRoot: fallbackRepoRoot,
    repoProvenance: { head: { commitId: 'fallback-head' }, dirty: false },
    filesPosix: fallbackFiles,
    includeChurn: false,
    timeoutMs: 25,
    maxFallbackConcurrency: 2,
    log: (line) => fallbackLogs.push(String(line || ''))
  });
  assert.equal(batchCalls, 1, 'expected one batch attempt before fallback');
  assert.equal(fallbackFileCalls.length, fallbackFiles.length, 'expected per-file fallback for each missing file');
  assert.equal(fallbackResult?.stats?.source, 'fallback');
  assert.equal(fallbackResult?.stats?.fetched, fallbackFiles.length);
  assert.equal(fallbackResult?.stats?.timeoutCount, 0);
  assert.equal(fallbackResult?.fileMetaByPath?.['src/a.js']?.lastAuthor, 'fallback-author:src/a.js');

  const diagnosticsResult = await prepareScmFileMetaSnapshot({
    repoCacheRoot: diagnosticsCacheRoot,
    provider: 'git',
    providerImpl: diagnosticsProviderImpl,
    repoRoot: diagnosticsRepoRoot,
    repoProvenance: { head: { commitId: 'diagnostics-head' }, dirty: false },
    filesPosix: diagnosticsFiles,
    includeChurn: false,
    timeoutMs: 25,
    maxFallbackConcurrency: 2,
    log: (line) => diagnosticsLogs.push(String(line || ''))
  });
  assert.equal(diagnosticsResult?.stats?.source, 'fresh');
  assert.equal(diagnosticsResult?.stats?.fetched, diagnosticsFiles.length);
  assert.equal(diagnosticsResult?.stats?.timeoutCount, 4);
  assert.equal(diagnosticsResult?.stats?.timeoutRetries, 3);
  assert.equal(diagnosticsResult?.stats?.cooldownSkips, 2);
  assert.equal(diagnosticsResult?.stats?.unavailableChunks, 1);
  assert.equal(diagnosticsResult?.stats?.timeoutHeatmap?.length, 4);
  assert.equal(diagnosticsLogs.length, 1, 'expected a single compact diagnostics log line');
  const diagnosticsLine = diagnosticsLogs[0];
  assert.match(diagnosticsLine, /timeoutCount=4/);
  assert.match(diagnosticsLine, /timeoutRetries=3/);
  assert.match(diagnosticsLine, /cooldownSkips=2/);
  assert.match(diagnosticsLine, /unavailableChunks=1/);
  assert.match(
    diagnosticsLine,
    /timeoutHeatmap=src\/a\.js:3t\/1c,src\/b\.js:2t\/0c,src\/c\.js:1t\/1c/
  );
  assert.equal(
    diagnosticsLine.includes('src/d.js:1t/0c'),
    false,
    'expected diagnostics log heatmap to remain top-3 and avoid noisy output'
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('git metadata snapshot diagnostics and fallback test passed');
