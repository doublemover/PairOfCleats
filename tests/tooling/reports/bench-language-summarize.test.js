#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'bench', 'language-summarize.js');
const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'bench-lang-summarize-'));
const currentRoot = path.join(tmpRoot, 'current');
const baselineRoot = path.join(tmpRoot, 'baseline');
const runReportPath = path.join(tmpRoot, 'run-report.json');
const outJsonPath = path.join(tmpRoot, 'summary.json');
const outMdPath = path.join(tmpRoot, 'summary.md');

const writeBenchResult = async ({
  targetRoot,
  language,
  repoSlug,
  buildIndexMs,
  buildSqliteMs,
  queryPerSearchMs,
  queryPerQueryMs,
  warnings = [],
  fallbackText = ''
}) => {
  const languageDir = path.join(targetRoot, language);
  await fsPromises.mkdir(languageDir, { recursive: true });
  const payload = {
    summary: {
      backends: ['memory', 'sqlite'],
      buildMs: {
        index: buildIndexMs,
        sqlite: buildSqliteMs
      },
      queryWallMsPerSearch: queryPerSearchMs,
      queryWallMsPerQuery: queryPerQueryMs,
      hitRate: {
        memory: 0.9,
        sqlite: 0.85
      }
    },
    artifacts: {
      corruption: {
        warnings
      },
      diagnostics: {
        note: fallbackText
      }
    }
  };
  const resultPath = path.join(languageDir, `${repoSlug}.json`);
  await fsPromises.writeFile(resultPath, JSON.stringify(payload, null, 2), 'utf8');
};

await writeBenchResult({
  targetRoot: currentRoot,
  language: 'javascript',
  repoSlug: 'acme__rocket',
  buildIndexMs: 1200,
  buildSqliteMs: 360,
  queryPerSearchMs: 75,
  queryPerQueryMs: 150,
  warnings: ['queue hotspot', 'fallback path used'],
  fallbackText: 'fallback_used due sparse pressure'
});
await writeBenchResult({
  targetRoot: currentRoot,
  language: 'ruby',
  repoSlug: 'foo__bar',
  buildIndexMs: 2500,
  buildSqliteMs: 500,
  queryPerSearchMs: 130,
  queryPerQueryMs: 260,
  warnings: ['artifact stall']
});

await writeBenchResult({
  targetRoot: baselineRoot,
  language: 'javascript',
  repoSlug: 'acme__rocket',
  buildIndexMs: 900,
  buildSqliteMs: 320,
  queryPerSearchMs: 55,
  queryPerQueryMs: 120,
  warnings: []
});
await writeBenchResult({
  targetRoot: baselineRoot,
  language: 'ruby',
  repoSlug: 'foo__bar',
  buildIndexMs: 2000,
  buildSqliteMs: 450,
  queryPerSearchMs: 110,
  queryPerQueryMs: 220,
  warnings: []
});

await fsPromises.writeFile(
  runReportPath,
  JSON.stringify({
    tasks: [
      { language: 'javascript', repo: 'acme/rocket', failed: false, skipped: false },
      { language: 'ruby', repo: 'foo/bar', failed: true, failureReason: 'bench', failureCode: 1 },
      { language: 'lua', repo: 'baz/qux', skipped: true }
    ]
  }, null, 2),
  'utf8'
);

const result = spawnSync(
  process.execPath,
  [
    scriptPath,
    '--results',
    currentRoot,
    '--baseline',
    baselineRoot,
    '--run-report',
    runReportPath,
    '--out-json',
    outJsonPath,
    '--out-md',
    outMdPath,
    '--json'
  ],
  { encoding: 'utf8' }
);

assert.equal(result.status, 0, result.stderr || result.stdout);

const payload = JSON.parse(result.stdout || '{}');
assert.equal(payload.aggregate?.totals?.repos, 3, 'expected matrix to include run-report tasks');
assert.equal(payload.aggregate?.totals?.passed, 1, 'expected one passed repo');
assert.equal(payload.aggregate?.totals?.failed, 1, 'expected one failed repo');
assert.equal(payload.aggregate?.totals?.skipped, 1, 'expected one skipped repo');
assert.ok(payload.aggregate?.signals?.warnings >= 1, 'expected warning signals to be counted');
assert.ok(payload.aggregate?.signals?.fallbacks >= 1, 'expected fallback signals to be counted');
assert.equal(payload.baselineDiff?.baselineCompared, true, 'expected baseline diff to be enabled');
assert.ok(Array.isArray(payload.baselineDiff?.regressions), 'expected regression list');
assert.ok(
  payload.bottlenecks?.buildIndex?.some((entry) => entry.repo === 'acme/rocket'),
  'expected bottleneck list to include passing repo'
);

assert.ok(fs.existsSync(outJsonPath), 'expected summary JSON output file');
assert.ok(fs.existsSync(outMdPath), 'expected summary markdown output file');

const markdown = await fsPromises.readFile(outMdPath, 'utf8');
assert.ok(markdown.includes('Pass/Fail Matrix'), 'expected pass/fail matrix section');
assert.ok(markdown.includes('Baseline Diff'), 'expected baseline diff section');
assert.ok(markdown.includes('acme/rocket'), 'expected markdown to include repo names');

await fsPromises.rm(tmpRoot, { recursive: true, force: true });

console.log('bench-language summarize test passed');
