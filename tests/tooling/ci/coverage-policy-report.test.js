#!/usr/bin/env node
import { ensureTestingEnv } from '../../helpers/test-env.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execaSync } from 'execa';

ensureTestingEnv(process.env);

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'ci', 'coverage-policy-report.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pairofcleats-coverage-policy-'));
const coveragePath = path.join(tempRoot, 'coverage.json');
const reportPath = path.join(tempRoot, 'coverage-policy.json');
const markdownPath = path.join(tempRoot, 'coverage-policy.md');

const runGit = (args) => execaSync('git', args, { cwd: tempRoot });

try {
  fs.mkdirSync(path.join(tempRoot, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'src', 'retrieval'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'bin', 'pairofcleats.js'), 'export const cli = 1;\n');
  fs.writeFileSync(path.join(tempRoot, 'src', 'retrieval', 'core.js'), 'export const retrieval = 1;\n');

  runGit(['init']);
  runGit(['config', 'user.name', 'PairOfCleats Tests']);
  runGit(['config', 'user.email', 'tests@example.invalid']);
  runGit(['add', '.']);
  runGit(['commit', '-m', 'base']);
  const baseSha = runGit(['rev-parse', 'HEAD']).stdout.trim();

  fs.writeFileSync(path.join(tempRoot, 'bin', 'pairofcleats.js'), 'export const cli = 2;\n');
  runGit(['add', 'bin/pairofcleats.js']);
  runGit(['commit', '-m', 'cli change']);
  const headSha = runGit(['rev-parse', 'HEAD']).stdout.trim();

  fs.writeFileSync(coveragePath, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runId: 'run-ci',
    pathPolicy: 'repo-relative-posix',
    kind: 'v8-range-summary',
    summary: {
      files: 2,
      coveredRanges: 16,
      totalRanges: 20
    },
    entries: [
      {
        path: 'bin/pairofcleats.js',
        coveredRanges: 6,
        totalRanges: 10
      },
      {
        path: 'src/retrieval/core.js',
        coveredRanges: 10,
        totalRanges: 10
      }
    ]
  }, null, 2)}\n`);

  const result = execaSync('node', [
    scriptPath,
    '--root',
    tempRoot,
    '--coverage',
    coveragePath,
    '--out',
    reportPath,
    '--markdown',
    markdownPath,
    '--mode',
    'ci',
    '--base',
    baseSha,
    '--head',
    headSha
  ], { cwd: root });

  const stdout = JSON.parse(result.stdout);
  if (stdout.outputPath !== reportPath) {
    console.error('coverage policy report test failed: expected outputPath in stdout payload');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (report.kind !== 'test-coverage-policy-report') {
    console.error('coverage policy report test failed: expected report kind');
    process.exit(1);
  }
  if (report.changedFiles.strategy !== 'explicit-git-range') {
    console.error('coverage policy report test failed: expected explicit-git-range strategy');
    process.exit(1);
  }
  if (report.changedFiles.summary.files !== 1) {
    console.error('coverage policy report test failed: expected one changed covered file');
    process.exit(1);
  }
  if (report.changedFiles.files[0]?.path !== 'bin/pairofcleats.js') {
    console.error('coverage policy report test failed: expected changed file path in report');
    process.exit(1);
  }
  const cliSurface = report.criticalSurfaces.find((entry) => entry.id === 'cli');
  const retrievalSurface = report.criticalSurfaces.find((entry) => entry.id === 'retrieval');
  if (!cliSurface || cliSurface.summary.files !== 1 || cliSurface.summary.coverageFraction !== 0.6) {
    console.error('coverage policy report test failed: expected CLI critical surface summary');
    process.exit(1);
  }
  if (!retrievalSurface || retrievalSurface.summary.files !== 1 || retrievalSurface.summary.coverageFraction !== 1) {
    console.error('coverage policy report test failed: expected retrieval critical surface summary');
    process.exit(1);
  }

  const markdown = fs.readFileSync(markdownPath, 'utf8');
  if (!markdown.includes('## Changed files') || !markdown.includes('## Critical surfaces')) {
    console.error('coverage policy report test failed: expected markdown sections');
    process.exit(1);
  }
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('coverage policy report test passed');
