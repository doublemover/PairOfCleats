#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import minimist from 'minimist';
import { getIndexDir, getMetricsDir, loadUserConfig, resolveSqlitePaths } from '../tools/dict-utils.js';

const root = process.cwd();
const fixturesRoot = path.join(root, 'tests', 'fixtures');
const argv = minimist(process.argv.slice(2), {
  boolean: ['all'],
  string: ['fixture'],
  default: { fixture: 'sample', all: false }
});

function resolveFixtures() {
  if (!argv.all) return [argv.fixture];
  const entries = fs.readdirSync(fixturesRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function hasPython() {
  const candidates = ['python', 'python3'];
  for (const cmd of candidates) {
    const result = spawnSync(cmd, ['-c', 'import sys; sys.stdout.write(\"ok\")'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim() === 'ok') return true;
  }
  return false;
}
const pythonAvailable = hasPython();

function run(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: currentFixtureRoot,
    env: currentEnv,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

function loadQueries(fixtureRoot) {
  const queriesPath = path.join(fixtureRoot, 'queries.txt');
  if (!fs.existsSync(queriesPath)) return ['index', 'search'];
  return fs.readFileSync(queriesPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

let currentFixtureRoot = '';
let currentEnv = {};

const fixtures = resolveFixtures();
if (!fixtures.length) {
  console.error('No fixtures found.');
  process.exit(1);
}

for (const fixtureName of fixtures) {
  currentFixtureRoot = path.join(fixturesRoot, fixtureName);
  if (!fs.existsSync(currentFixtureRoot)) {
    console.error(`Fixture not found: ${currentFixtureRoot}`);
    process.exit(1);
  }
  console.log(`\nFixture smoke: ${fixtureName}`);

  const cacheRoot = path.join(root, 'tests', '.cache', `fixture-${fixtureName}`);
  await fsPromises.rm(cacheRoot, { recursive: true, force: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  currentEnv = {
    ...process.env,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_EMBEDDINGS: 'stub'
  };
  process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;

  run([path.join(root, 'build_index.js'), '--stub-embeddings'], `build index (${fixtureName})`);
  run([path.join(root, 'tools', 'build-sqlite-index.js')], `build sqlite index (${fixtureName})`);

  const userConfig = loadUserConfig(currentFixtureRoot);
  const codeDir = getIndexDir(currentFixtureRoot, 'code', userConfig);
  const proseDir = getIndexDir(currentFixtureRoot, 'prose', userConfig);
  const sqlitePaths = resolveSqlitePaths(currentFixtureRoot, userConfig);
  const metricsDir = getMetricsDir(currentFixtureRoot, userConfig);

  const requiredFiles = [
    path.join(codeDir, 'chunk_meta.json'),
    path.join(codeDir, 'token_postings.json'),
    path.join(proseDir, 'chunk_meta.json'),
    path.join(proseDir, 'token_postings.json'),
    path.join(metricsDir, 'index-code.json'),
    path.join(metricsDir, 'index-prose.json'),
    sqlitePaths.codePath,
    sqlitePaths.prosePath
  ];

  for (const filePath of requiredFiles) {
    if (!fs.existsSync(filePath)) {
      console.error(`Missing fixture artifact: ${filePath}`);
      process.exit(1);
    }
  }

  const queries = loadQueries(currentFixtureRoot);
  const backends = ['memory', 'sqlite-fts'];
  for (const query of queries) {
    for (const backend of backends) {
      const searchResult = spawnSync(
        process.execPath,
        [path.join(root, 'search.js'), query, '--json', '--backend', backend, '--no-ann'],
        { cwd: currentFixtureRoot, env: currentEnv, encoding: 'utf8' }
      );
      if (searchResult.status !== 0) {
        console.error(`Fixture search failed for query: ${query} (${backend})`);
        process.exit(searchResult.status ?? 1);
      }

      const payload = JSON.parse(searchResult.stdout || '{}');
      if (!payload.code?.length && !payload.prose?.length) {
        console.error(`Fixture search returned no results for query: ${query} (${backend})`);
        process.exit(1);
      }
    }
  }

  if (pythonAvailable && fixtureName === 'sample') {
    const pythonCheck = spawnSync(
      process.execPath,
      [path.join(root, 'search.js'), 'message', '--json', '--backend', 'memory', '--no-ann'],
      { cwd: currentFixtureRoot, env: currentEnv, encoding: 'utf8' }
    );
    if (pythonCheck.status !== 0) {
      console.error('Python AST check failed: search error.');
      process.exit(pythonCheck.status ?? 1);
    }
    const payload = JSON.parse(pythonCheck.stdout || '{}');
    const pythonHit = (payload.code || []).find(
      (hit) => hit.file === 'src/sample.py' && hit.name && hit.name.endsWith('message')
    );
    if (!pythonHit) {
      console.error('Python AST check failed: missing sample.py message chunk.');
      process.exit(1);
    }
    const signature = pythonHit.docmeta?.signature || '';
    const decorators = pythonHit.docmeta?.decorators || [];
    if (!signature.includes('def message')) {
      console.error('Python AST check failed: missing signature metadata.');
      process.exit(1);
    }
    if (!decorators.includes('staticmethod')) {
      console.error('Python AST check failed: missing decorator metadata.');
      process.exit(1);
    }
  }

  if (fixtureName === 'sample') {
    const swiftCheck = spawnSync(
      process.execPath,
      [path.join(root, 'search.js'), 'sayHello', '--json', '--backend', 'memory', '--no-ann'],
      { cwd: currentFixtureRoot, env: currentEnv, encoding: 'utf8' }
    );
    if (swiftCheck.status !== 0) {
      console.error('Swift check failed: search error.');
      process.exit(swiftCheck.status ?? 1);
    }
    const payload = JSON.parse(swiftCheck.stdout || '{}');
    const swiftHit = (payload.code || []).find(
      (hit) => hit.file === 'src/sample.swift' && hit.name === 'Greeter.sayHello'
    );
    if (!swiftHit) {
      console.error('Swift check failed: missing sample.swift sayHello chunk.');
      process.exit(1);
    }
    const signature = swiftHit.docmeta?.signature || '';
    const decorators = swiftHit.docmeta?.decorators || [];
    if (!signature.includes('func sayHello')) {
      console.error('Swift check failed: missing signature metadata.');
      process.exit(1);
    }
    if (!decorators.includes('available')) {
      console.error('Swift check failed: missing attribute metadata.');
      process.exit(1);
    }
  }

  if (fixtureName === 'sample') {
    const rustCheck = spawnSync(
      process.execPath,
      [path.join(root, 'search.js'), 'rust_greet', '--json', '--backend', 'memory', '--no-ann'],
      { cwd: currentFixtureRoot, env: currentEnv, encoding: 'utf8' }
    );
    if (rustCheck.status !== 0) {
      console.error('Rust check failed: search error.');
      process.exit(rustCheck.status ?? 1);
    }
    const payload = JSON.parse(rustCheck.stdout || '{}');
    const rustHit = (payload.code || []).find(
      (hit) => hit.file === 'src/sample.rs' && hit.name === 'rust_greet'
    );
    if (!rustHit) {
      console.error('Rust check failed: missing sample.rs rust_greet chunk.');
      process.exit(1);
    }
    const signature = rustHit.docmeta?.signature || '';
    if (!signature.includes('fn rust_greet')) {
      console.error('Rust check failed: missing signature metadata.');
      process.exit(1);
    }
  }
}

console.log('Fixture smoke tests passed');
