#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { Packr, Unpackr } from 'msgpackr';

import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { LMDB_ARTIFACT_KEYS, LMDB_META_KEYS } from '../../../src/storage/lmdb/schema.js';
import { loadUserConfig, resolveLmdbPaths } from '../../../tools/shared/dict-utils.js';

let open = null;
try {
  ({ open } = await import('lmdb'));
} catch (err) {
  console.error(`lmdb missing: ${err?.message || err}`);
  process.exit(1);
}

const packr = new Packr();
const unpackr = new Unpackr();
const decode = (value) => (value == null ? null : unpackr.unpack(value));

const root = process.cwd();
const createTestConfig = (extraTestConfig = null) => ({
  indexing: {
    scm: { provider: 'none' },
    typeInference: false,
    typeInferenceCrossFile: false,
    riskAnalysis: false,
    riskAnalysisCrossFile: false,
    embeddings: {
      enabled: false,
      mode: 'off',
      lancedb: { enabled: false },
      hnsw: { enabled: false }
    }
  },
  tooling: {
    autoEnableOnDetect: false,
    lsp: {
      enabled: false
    }
  },
  lmdb: {
    use: true
  },
  ...(extraTestConfig || {})
});

const createFixture = async (name, extraTestConfig = null) => {
  const tempRoot = resolveTestCachePath(root, name);
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(tempRoot, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'sample.js'),
    [
      'export function greet(name = "world") {',
      '  return `hello ${name}`;',
      '}',
      ''
    ].join('\n'),
    'utf8'
  );
  await fsPromises.writeFile(
    path.join(repoRoot, 'README.md'),
    '# LMDB report fixture\n\nhello prose fixture\n',
    'utf8'
  );

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: createTestConfig(extraTestConfig),
    extraEnv: {
      PAIROFCLEATS_WORKER_POOL: 'off'
    }
  });

  const run = (args, label, options = {}) => {
    const result = spawnSync(process.execPath, args, {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
      ...options
    });
    if (result.status !== 0) {
      console.error(`Failed: ${label}`);
      if (result.stderr) console.error(result.stderr.trim());
      process.exit(result.status ?? 1);
    }
    return result;
  };

  run(
    [
      path.join(root, 'build_index.js'),
      '--stub-embeddings',
      '--stage',
      'stage1',
      '--repo',
      repoRoot
    ],
    'build index',
    { stdio: 'inherit' }
  );
  run(
    [path.join(root, 'tools', 'build/lmdb-index.js'), '--mode', 'all', '--repo', repoRoot],
    'build lmdb index',
    { stdio: 'inherit' }
  );

  return {
    tempRoot,
    repoRoot,
    run,
    lmdbPaths: resolveLmdbPaths(repoRoot, loadUserConfig(repoRoot))
  };
};

const snapshotPathTree = async (sourcePath, snapshotPath) => {
  await fsPromises.rm(snapshotPath, { recursive: true, force: true });
  await fsPromises.cp(sourcePath, snapshotPath, { recursive: true });
};

const restorePathTree = async (snapshotPath, targetPath) => {
  await fsPromises.rm(targetPath, { recursive: true, force: true });
  await fsPromises.cp(snapshotPath, targetPath, { recursive: true });
};

const runHealthyReportScenario = async (fixture) => {
  const report = fixture.run(
    [path.join(root, 'tools', 'index', 'report-artifacts.js'), '--json', '--repo', fixture.repoRoot],
    'report artifacts'
  );

  let payload = null;
  try {
    payload = JSON.parse(report.stdout || '{}');
  } catch {
    throw new Error('Failed to parse report-artifacts JSON output.');
  }

  const lmdbThroughput = payload?.throughput?.lmdb;
  if (!lmdbThroughput?.code || !Number.isFinite(lmdbThroughput.code.chunksPerSec)) {
    throw new Error('LMDB code throughput missing or invalid in report-artifacts.');
  }
  if (!lmdbThroughput?.prose || !Number.isFinite(lmdbThroughput.prose.chunksPerSec)) {
    throw new Error('LMDB prose throughput missing or invalid in report-artifacts.');
  }
  if (payload?.corruption?.lmdb?.ok !== true) {
    throw new Error('LMDB corruption report expected ok=true.');
  }

  const lmdbDb = open({ path: fixture.lmdbPaths.codePath, readOnly: false });
  const artifacts = decode(lmdbDb.get(LMDB_META_KEYS.artifacts)) || [];
  const filtered = artifacts.filter((key) => key !== LMDB_ARTIFACT_KEYS.tokenPostings);
  lmdbDb.putSync(LMDB_META_KEYS.artifacts, packr.pack(filtered));
  lmdbDb.close();

  const reportMissing = fixture.run(
    [path.join(root, 'tools', 'index', 'report-artifacts.js'), '--json', '--repo', fixture.repoRoot],
    'report artifacts (missing lmdb key)'
  );
  let payloadMissing = null;
  try {
    payloadMissing = JSON.parse(reportMissing.stdout || '{}');
  } catch {
    throw new Error('Failed to parse report-artifacts JSON output (missing key).');
  }
  const issues = Array.isArray(payloadMissing?.corruption?.issues) ? payloadMissing.corruption.issues : [];
  if (!issues.some((issue) => issue.includes('missing artifact key') && issue.includes('token_postings'))) {
    throw new Error('Expected missing artifact key issue for LMDB token_postings.');
  }
};

const runCorruptionScenario = async (fixture) => {
  const db = open({ path: fixture.lmdbPaths.codePath, readOnly: false });
  if (typeof db.removeSync === 'function') {
    db.removeSync(LMDB_META_KEYS.schemaVersion);
  } else {
    db.remove(LMDB_META_KEYS.schemaVersion);
  }
  db.close();

  const report = fixture.run(
    [path.join(root, 'tools', 'index', 'report-artifacts.js'), '--json', '--repo', fixture.repoRoot],
    'report artifacts'
  );

  let payload = null;
  try {
    payload = JSON.parse(report.stdout || '{}');
  } catch {
    throw new Error('Failed to parse report-artifacts JSON output.');
  }

  if (payload?.corruption?.ok !== false) {
    throw new Error('Expected corruption report ok=false after LMDB tamper.');
  }
  if (payload?.corruption?.lmdb?.ok !== false) {
    throw new Error('Expected LMDB corruption report ok=false.');
  }
  const issues = Array.isArray(payload?.corruption?.issues) ? payload.corruption.issues : [];
  if (!issues.some((issue) => issue.includes('lmdb/code'))) {
    throw new Error('Expected LMDB corruption issues for code db.');
  }
  if (!issues.some((issue) => issue.includes('schema mismatch'))) {
    throw new Error('Expected LMDB schema mismatch issue after tampering.');
  }
};

const fixture = await createFixture('lmdb-report-contract-matrix');
const codeSnapshotPath = path.join(fixture.tempRoot, 'code-snapshot');
await snapshotPathTree(fixture.lmdbPaths.codePath, codeSnapshotPath);

try {
  await runHealthyReportScenario(fixture);
  await restorePathTree(codeSnapshotPath, fixture.lmdbPaths.codePath);
  await runCorruptionScenario(fixture);
} catch (error) {
  console.error('lmdb report contract matrix failed');
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}

console.log('lmdb report contract matrix passed (2 cases)');
