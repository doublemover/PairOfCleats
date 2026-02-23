#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createCrashLogger, retainCrashArtifacts } from '../../src/index/build/crash-log.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'crash-log-retention');
const repoCacheRoot = path.join(tempRoot, 'cache', 'repo-cache');
const diagnosticsRoot = path.join(tempRoot, 'results', 'logs', 'bench-language', 'run-ub003-diagnostics');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoCacheRoot, { recursive: true });

const crashLogger = await createCrashLogger({
  repoCacheRoot,
  enabled: true
});

await crashLogger.persistForensicBundle({
  kind: 'tree-sitter-scheduler-crash',
  signature: 'ub003-perl-crash',
  bundle: {
    events: [
      {
        signature: 'sig-1',
        parser: {
          provider: 'tree-sitter-native',
          languageId: 'perl',
          grammarModule: 'tree-sitter-perl'
        }
      }
    ]
  }
});
crashLogger.logError({
  phase: 'processing',
  stage: 'tree-sitter-scheduler',
  file: 'src/perl_advanced.pl',
  message: 'synthetic parser crash'
});

const crashLogPath = path.join(repoCacheRoot, 'logs', 'index-crash.log');
await fsPromises.appendFile(
  crashLogPath,
  '[tree-sitter:schedule] batch 1/2: perl\n[tree-sitter:schedule] parser crash contained\n',
  'utf8'
);

const durableForensicsDir = path.join(path.dirname(repoCacheRoot), '_crash-forensics');
await fsPromises.mkdir(durableForensicsDir, { recursive: true });
await fsPromises.writeFile(
  path.join(durableForensicsDir, 'repo-cache-build-crash-forensics.json'),
  JSON.stringify({
    schemaVersion: '1.0.0',
    events: [
      {
        signature: 'sig-2',
        parser: {
          provider: 'tree-sitter-native',
          languageId: 'perl',
          grammarModule: 'tree-sitter-perl'
        }
      }
    ]
  }, null, 2),
  'utf8'
);

const retention = await retainCrashArtifacts({
  repoCacheRoot,
  diagnosticsRoot,
  repoLabel: 'perl/owner/repo',
  repoSlug: 'owner-repo',
  runId: 'run-20260222-000000',
  failure: {
    reason: 'bench',
    code: 1
  },
  runtime: {
    language: 'perl',
    repo: 'owner/repo',
    tier: 'typical'
  },
  environment: {
    selected: {
      PAIROFCLEATS_TESTING: process.env.PAIROFCLEATS_TESTING
    }
  },
  schedulerEvents: [
    {
      ts: '2026-02-22T00:00:00.000Z',
      message: '[tree-sitter:schedule] warm pool task failed',
      source: 'progress-event',
      stage: 'processing'
    }
  ],
  logTail: ['[error] benchmark failed for perl/owner/repo']
});

assert.ok(retention?.bundlePath, 'expected crash retention bundle path');
assert.ok(retention?.markerPath, 'expected crash retention marker path');
assert.equal(fs.existsSync(retention.bundlePath), true, 'expected retained bundle to exist');
assert.equal(fs.existsSync(retention.markerPath), true, 'expected retained marker to exist');

const retainedBundle = JSON.parse(await fsPromises.readFile(retention.bundlePath, 'utf8'));
const retainedMarker = JSON.parse(await fsPromises.readFile(retention.markerPath, 'utf8'));
assert.equal(retainedBundle.failure.reason, 'bench', 'expected retained failure reason');
assert.equal(retainedBundle.runtime.repo, 'owner/repo', 'expected retained runtime metadata');
assert.equal(
  retainedBundle.environment.selected.PAIROFCLEATS_TESTING,
  '1',
  'expected retained env metadata'
);
assert.equal(
  retainedBundle.parserMetadata.some((entry) => entry?.languageId === 'perl'),
  true,
  'expected parser metadata in retained bundle'
);
assert.equal(
  retainedBundle.schedulerEvents.some((entry) => String(entry?.message || '').includes('[tree-sitter:schedule]')),
  true,
  'expected scheduler events in retained bundle'
);
assert.match(retainedBundle.consistency.checksum, /^sha1:/, 'expected bundle checksum marker');
assert.equal(
  retainedMarker.checksum,
  retainedBundle.consistency.checksum,
  'expected marker checksum to match bundle checksum'
);
assert.ok(
  Array.isArray(retainedBundle.copiedArtifacts) && retainedBundle.copiedArtifacts.length > 0,
  'expected copied crash artifacts in retained bundle'
);

await fsPromises.rm(repoCacheRoot, { recursive: true, force: true });
await fsPromises.rm(durableForensicsDir, { recursive: true, force: true });

assert.equal(fs.existsSync(retention.bundlePath), true, 'retained bundle should survive cache cleanup');
assert.equal(fs.existsSync(retention.markerPath), true, 'retained marker should survive cache cleanup');
const persistedBundle = JSON.parse(await fsPromises.readFile(retention.bundlePath, 'utf8'));
for (const artifact of persistedBundle.copiedArtifacts || []) {
  assert.equal(fs.existsSync(artifact.path), true, `retained artifact missing after cleanup: ${artifact.path}`);
}

console.log('crash log retention test passed');
