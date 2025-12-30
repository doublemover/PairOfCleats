#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const fixturesRoot = path.join(root, 'tests', 'fixtures');

function resolveFixtures() {
  const entries = fs.readdirSync(fixturesRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function run(args, label, cwd, env) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

const fixtures = resolveFixtures();
if (!fixtures.length) {
  console.error('No fixtures found.');
  process.exit(1);
}

for (const fixtureName of fixtures) {
  const fixtureRoot = path.join(fixturesRoot, fixtureName);
  const cacheRoot = path.join(root, 'tests', '.cache', `parity-${fixtureName}`);
  console.log(`\nFixture parity: ${fixtureName}`);
  await fsPromises.rm(cacheRoot, { recursive: true, force: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  const env = {
    ...process.env,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_EMBEDDINGS: 'stub'
  };

  run([path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', fixtureRoot], `build index (${fixtureName})`, fixtureRoot, env);
  run([path.join(root, 'tools', 'build-sqlite-index.js'), '--repo', fixtureRoot], `build sqlite index (${fixtureName})`, fixtureRoot, env);

  const queriesPath = path.join(fixtureRoot, 'queries.txt');
  const queryFile = fs.existsSync(queriesPath)
    ? queriesPath
    : path.join(root, 'tests', 'parity-queries.txt');

  run([
    path.join(root, 'tests', 'parity.js'),
    '--no-ann',
    '--queries',
    queryFile,
    '--search',
    path.join(root, 'search.js'),
    '--top',
    '5'
  ], `parity (${fixtureName})`, fixtureRoot, env);
}

console.log('Fixture parity tests passed');
