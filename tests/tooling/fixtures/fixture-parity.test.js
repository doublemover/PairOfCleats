#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { runNode } from '../../helpers/run-node.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixturesRoot = path.join(root, 'tests', 'fixtures');
const argv = createCli({
  scriptName: 'fixture-parity',
  options: {
    all: { type: 'boolean', default: false },
    fixture: { type: 'string', default: 'sample' },
    fixtures: { type: 'string', default: '' },
    'timeout-ms': { type: 'number', default: 300000 }
  }
}).parse();
const parsedTimeout = Number.isFinite(argv['timeout-ms']) ? argv['timeout-ms'] : 300000;
const timeoutMs = Math.max(1000, Math.floor(parsedTimeout));
const defaultProfile = process.platform === 'win32' ? 'ci-parity' : '';
const resolvedProfile = process.env.PAIROFCLEATS_PROFILE || defaultProfile;
const runTag = String(process.pid);

function resolveFixtures() {
  if (argv.fixtures) {
    const list = argv.fixtures
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (list.length) return list;
  }
  const entries = fs.readdirSync(fixturesRoot, { withFileTypes: true });
  const allFixtures = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (argv.all) return allFixtures;
  return [argv.fixture];
}

const fixtures = resolveFixtures();
if (!fixtures.length) {
  console.error('No fixtures found.');
  process.exit(1);
}

for (const fixtureName of fixtures) {
  const fixtureRoot = path.join(fixturesRoot, fixtureName);
  if (!fs.existsSync(fixtureRoot)) {
    console.error(`Fixture not found: ${fixtureRoot}`);
    process.exit(1);
  }
  const cacheRoot = resolveTestCachePath(root, `parity-${fixtureName}-${runTag}`);
  console.log(`\nFixture parity: ${fixtureName}`);
  await fsPromises.rm(cacheRoot, { recursive: true, force: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    extraEnv: resolvedProfile
      ? { PAIROFCLEATS_PROFILE: resolvedProfile }
      : null
  });
  if (resolvedProfile) {
    console.log(`[fixture-parity] profile=${resolvedProfile}`);
  }

  runNode(
    [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', fixtureRoot],
    `build index (${fixtureName})`,
    fixtureRoot,
    env,
    { timeoutMs }
  );
  await runSqliteBuild(fixtureRoot);

  const queriesPath = path.join(fixtureRoot, 'queries.txt');
  const queryFile = fs.existsSync(queriesPath)
    ? queriesPath
    : path.join(root, 'tests', 'retrieval', 'parity', 'parity-queries.txt');

  runNode(
    [
      path.join(root, 'tests', 'retrieval', 'parity', 'parity.test.js'),
      '--no-ann',
      '--queries',
      queryFile,
      '--search',
      path.join(root, 'search.js'),
      '--top',
      '5'
    ],
    `parity (${fixtureName})`,
    fixtureRoot,
    env,
    { timeoutMs }
  );
}

console.log('Fixture parity tests passed');

