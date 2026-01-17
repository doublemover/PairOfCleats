#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../src/shared/cli.js';
import { resolveRepoRoot } from './dict-utils.js';
import { validateIndexArtifacts } from '../src/index/validate.js';

const parseModes = (raw) => {
  const tokens = String(raw || '')
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const modeSet = new Set(tokens.length ? tokens : ['code', 'prose']);
  if (modeSet.has('all')) return ['code', 'prose', 'extracted-prose', 'records'];
  return Array.from(modeSet);
};

async function runCli() {
  const argv = createCli({
    scriptName: 'index-validate',
    options: {
      json: { type: 'boolean', default: false },
      repo: { type: 'string' },
      mode: { type: 'string' },
      'index-root': { type: 'string' }
    }
  }).parse();

  const rootArg = argv.repo ? path.resolve(argv.repo) : null;
  const root = rootArg || resolveRepoRoot(process.cwd());
  const indexRoot = argv['index-root'] ? path.resolve(argv['index-root']) : null;
  const modes = parseModes(argv.mode);
  const report = await validateIndexArtifacts({ root, indexRoot, modes });

  if (argv.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }

  console.log('Index validation');
  console.log(`- repo: ${report.root}`);
  for (const mode of modes) {
    const entry = report.modes[mode];
    const status = entry.ok ? 'ok' : 'missing';
    console.log(`- ${mode}: ${status} (${entry.path})`);
    if (entry.missing.length) {
      console.log(`  - missing: ${entry.missing.join(', ')}`);
    }
    if (entry.warnings.length) {
      console.log(`  - optional: ${entry.warnings.join(', ')}`);
    }
  }
  if (report.sqlite.enabled) {
    const status = report.sqlite.ok ? 'ok' : 'issues';
    console.log(`- sqlite: ${status} (mode=${report.sqlite.mode})`);
    if (report.sqlite.issues.length) {
      report.sqlite.issues.forEach((issue) => console.log(`  - ${issue}`));
    }
  }
  if (report.lmdb?.enabled) {
    const status = report.lmdb.ok ? 'ok' : 'issues';
    console.log(`- lmdb: ${status}`);
    if (report.lmdb.issues.length) {
      report.lmdb.issues.forEach((issue) => console.log(`  - ${issue}`));
    }
    if (report.lmdb.warnings.length) {
      report.lmdb.warnings.forEach((warning) => console.log(`  - warning: ${warning}`));
    }
  }

  if (report.warnings.length && report.ok) {
    console.log('Warnings:');
    report.warnings.forEach((warning) => console.log(`- ${warning}`));
  }
  if (!report.ok) {
    console.log('Issues:');
    report.issues.forEach((issue) => console.log(`- ${issue}`));
  }
  if (report.hints?.length) {
    console.log('Hints:');
    report.hints.forEach((hint) => console.log(`- ${hint}`));
  }
  process.exit(report.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
