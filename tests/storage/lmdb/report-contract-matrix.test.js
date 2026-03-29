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
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');

const createFixture = async (name, extraTestConfig = null) => {
  const tempRoot = resolveTestCachePath(root, name);
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(tempRoot, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: extraTestConfig
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
    [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
    'build index',
    { stdio: 'inherit' }
  );
  run(
    [path.join(root, 'tools', 'build/lmdb-index.js'), '--mode', 'all', '--repo', repoRoot],
    'build lmdb index',
    { stdio: 'inherit' }
  );

  return {
    repoRoot,
    run,
    lmdbPaths: resolveLmdbPaths(repoRoot, loadUserConfig(repoRoot))
  };
};

const runHealthyReportScenario = async () => {
  const fixture = await createFixture('lmdb-report-contract-matrix', { lmdb: { use: true } });
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

const runCorruptionScenario = async () => {
  const fixture = await createFixture('lmdb-corruption-contract-matrix');
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

const cases = [
  { name: 'healthy report and missing artifact detection', run: runHealthyReportScenario },
  { name: 'schema corruption detection', run: runCorruptionScenario }
];

for (const testCase of cases) {
  try {
    await testCase.run();
  } catch (error) {
    console.error(`lmdb report contract matrix failed: ${testCase.name}`);
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  }
}

console.log(`lmdb report contract matrix passed (${cases.length} cases)`);
