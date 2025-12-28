#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import minimist from 'minimist';

const argv = minimist(process.argv.slice(2), {
  boolean: ['json', 'write-report'],
  string: ['backend', 'out'],
  alias: { n: 'top' },
  default: { top: 5, backend: 'memory', json: false, 'write-report': false }
});

const root = process.cwd();
const fixturesRoot = path.join(root, 'tests', 'fixtures');
const searchPath = path.join(root, 'search.js');

function resolveFixtures() {
  const entries = fs.readdirSync(fixturesRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function run(args, label, cwd, env, inherit = false) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
}

function loadCases(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function matchExpected(hit, expected) {
  if (!hit) return false;
  if (expected.file && hit.file !== expected.file) return false;
  if (expected.name) {
    const hitName = hit.name ? String(hit.name).toLowerCase() : '';
    if (!hitName.includes(String(expected.name).toLowerCase())) return false;
  }
  if (expected.kind) {
    if (!hit.kind || String(hit.kind).toLowerCase() !== String(expected.kind).toLowerCase()) return false;
  }
  return true;
}

const fixtures = resolveFixtures();
if (!fixtures.length) {
  console.error('No fixtures found.');
  process.exit(1);
}

const topN = Math.max(1, parseInt(argv.top, 10) || 5);
const backend = argv.backend || 'memory';
const needsSqlite = backend !== 'memory';

const results = [];
for (const fixtureName of fixtures) {
  const fixtureRoot = path.join(fixturesRoot, fixtureName);
  const evalPath = path.join(fixtureRoot, 'eval.json');
  if (!fs.existsSync(evalPath)) continue;

  const cacheRoot = path.join(root, 'tests', '.cache', `eval-${fixtureName}`);
  await fsPromises.rm(cacheRoot, { recursive: true, force: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  const env = {
    ...process.env,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_EMBEDDINGS: 'stub'
  };

  console.log(`\nFixture eval: ${fixtureName}`);
  run([path.join(root, 'build_index.js'), '--stub-embeddings'], `build index (${fixtureName})`, fixtureRoot, env, true);
  if (needsSqlite) {
    run([path.join(root, 'tools', 'build-sqlite-index.js')], `build sqlite (${fixtureName})`, fixtureRoot, env, true);
  }

  const cases = loadCases(evalPath);
  if (!cases.length) {
    console.warn(`No eval cases found at ${evalPath}`);
    continue;
  }

  let passed = 0;
  let mrrSum = 0;
  const caseResults = [];

  for (const entry of cases) {
    const query = String(entry.query || '').trim();
    if (!query) continue;
    const mode = entry.mode || 'both';
    const expected = Array.isArray(entry.expect) ? entry.expect : [];

    const args = [
      searchPath,
      query,
      '--json',
      '--backend',
      backend,
      '--no-ann',
      '-n',
      String(topN)
    ];
    if (mode && mode !== 'both') {
      args.push('--mode', mode);
    }

    const stdout = run(args, `search (${fixtureName}:${query})`, fixtureRoot, env, false);
    const payload = JSON.parse(stdout || '{}');
    const hits = mode === 'code'
      ? (payload.code || [])
      : mode === 'prose'
        ? (payload.prose || [])
        : [...(payload.code || []), ...(payload.prose || [])];

    let rank = null;
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      if (expected.some((exp) => matchExpected(hit, exp))) {
        rank = i + 1;
        break;
      }
    }

    const ok = rank !== null;
    if (ok) {
      passed += 1;
      mrrSum += 1 / rank;
    }

    caseResults.push({
      query,
      mode,
      expected,
      ok,
      rank
    });
  }

  const total = caseResults.length;
  const mrr = total ? mrrSum / total : 0;

  results.push({
    fixture: fixtureName,
    total,
    passed,
    mrr,
    cases: caseResults
  });

  console.log(`- Passed: ${passed}/${total}`);
  console.log(`- MRR: ${mrr.toFixed(3)}`);
  const failed = caseResults.filter((c) => !c.ok);
  if (failed.length) {
    console.log(`- Failed: ${failed.map((c) => c.query).join(', ')}`);
  }
}

const summary = {
  fixtures: results.length,
  total: results.reduce((sum, r) => sum + r.total, 0),
  passed: results.reduce((sum, r) => sum + r.passed, 0),
  mrrAvg: results.length ? results.reduce((sum, r) => sum + r.mrr, 0) / results.length : 0
};

const output = {
  generatedAt: new Date().toISOString(),
  backend,
  topN,
  summary,
  results
};

if (argv.json) {
  console.log(JSON.stringify(output, null, 2));
}

if (argv['write-report']) {
  const outPath = argv.out ? path.resolve(argv.out) : path.join(root, 'docs', 'fixture-eval.json');
  await fsPromises.writeFile(outPath, JSON.stringify(output, null, 2));
  if (!argv.json) console.log(`Report written to ${outPath}`);
}

if (!argv.json) {
  console.log(`\nTotal passed: ${summary.passed}/${summary.total}`);
  console.log(`MRR avg: ${summary.mrrAvg.toFixed(3)}`);
}
