#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { runNode } from '../../helpers/run-node.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const argv = createCli({
  scriptName: 'fixture-eval',
  options: {
    json: { type: 'boolean', default: false },
    'write-report': { type: 'boolean', default: false },
    backend: { type: 'string', default: 'memory' },
    out: { type: 'string' },
    top: { type: 'number', default: 5 }
  },
  aliases: { n: 'top' }
}).parse();

const root = process.cwd();
const fixturesRoot = path.join(root, 'tests', 'fixtures');
const evalPath = path.join(root, 'tools', 'eval', 'run.js');
const showcaseSources = [
  'src/retrieval/cli-args.js',
  'src/integrations/tooling/providers/lsp/session-pool.js',
  'src/integrations/tooling/providers/lsp.js',
  'tools/testing/search-debug-capture.js',
  'docs/api/server.md',
  'docs/guides/search.md',
  'docs/api/core-api.md'
];

function resolveFixtures() {
  const entries = fs.readdirSync(fixturesRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function run(args, label, cwd, env, inherit = false) {
  const result = runNode(args, label, cwd, env, {
    stdio: inherit ? 'inherit' : 'pipe',
    allowFailure: true
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

const runnerFixture = {
  'tooling/fixtures/fixture-eval': 'sample',
  'tooling/fixtures/fixture-eval-mixed': 'mixed',
  'tooling/fixtures/fixture-eval-showcase': 'pairofcleats-search-showcase'
}[process.env.PAIROFCLEATS_TEST_ID];
const fixtures = runnerFixture ? [runnerFixture] : resolveFixtures();
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
  const datasetPath = path.join(fixtureRoot, 'eval.json');
  if (!fs.existsSync(datasetPath)) continue;

  const cacheRoot = resolveTestCachePath(root, `eval-${fixtureName}`);
  await fsPromises.rm(cacheRoot, { recursive: true, force: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  const repoRoot = fixtureName === 'pairofcleats-search-showcase'
    ? path.join(cacheRoot, 'repo')
    : fixtureRoot;
  if (repoRoot !== fixtureRoot) {
    for (const relativePath of showcaseSources) {
      const destination = path.join(repoRoot, relativePath);
      await fsPromises.mkdir(path.dirname(destination), { recursive: true });
      await fsPromises.copyFile(path.join(root, relativePath), destination);
    }
  }

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: {
      ...(repoRoot !== fixtureRoot
        ? { extraIgnore: ['!tools/testing/search-debug-capture.js'] }
        : {}),
      indexing: {
        scm: { provider: 'none' },
        typeInference: false,
        typeInferenceCrossFile: false,
        riskAnalysis: false,
        riskAnalysisCrossFile: false
      },
      tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
    },
    syncProcess: false
  });

  console.log(`\nFixture eval: ${fixtureName}`);
  run([path.join(root, 'build_index.js'), '--stage', 'stage1', '--stub-embeddings', '--repo', repoRoot], `build index (${fixtureName})`, repoRoot, env, true);
  if (needsSqlite) {
    await runSqliteBuild(repoRoot, { env });
  }

  const cases = loadCases(datasetPath);
  if (!cases.length) {
    console.warn(`No eval cases found at ${datasetPath}`);
    continue;
  }

  const stdout = run([
    evalPath,
    '--repo', repoRoot,
    '--dataset', datasetPath,
    '--backend', backend,
    '--no-ann',
    '--top', String(topN),
    '--quiet'
  ], `eval search (${fixtureName})`, repoRoot, env, false);
  const payload = JSON.parse(stdout || '{}');
  const eligibleCases = cases.filter((entry) => String(entry.query || '').trim());
  if (!Array.isArray(payload.results) || payload.results.length !== eligibleCases.length) {
    throw new Error(`Eval runner returned an incomplete result set for ${fixtureName}`);
  }

  let passed = 0;
  let mrrSum = 0;
  const caseResults = [];

  for (const [index, entry] of eligibleCases.entries()) {
    const query = String(entry.query || '').trim();
    const mode = entry.mode || 'both';
    const expected = Array.isArray(entry.expect) ? entry.expect : [];
    const result = payload.results[index];
    if (result.query !== query || result.mode !== mode || result.totals?.relevant !== expected.length) {
      throw new Error(`Eval runner result identity mismatch for ${fixtureName}:${query}`);
    }
    const queryMrr = result.metrics?.mrr || 0;
    const rank = queryMrr > 0 ? Math.round(1 / queryMrr) : null;

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

if (summary.passed !== summary.total) {
  console.error(`Fixture eval missed ${summary.total - summary.passed} expected queries`);
  process.exitCode = 1;
}

