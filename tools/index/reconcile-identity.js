#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../src/shared/cli.js';
import { reconcileIndexIdentity } from '../../src/index/identity/reconcile.js';
import { getIndexDir, resolveRepoConfig } from '../shared/dict-utils.js';

const normalizeMode = (value) => {
  const mode = String(value || 'code').trim().toLowerCase();
  if (!['code', 'prose', 'extracted-prose', 'records'].includes(mode)) {
    throw new Error(`Unknown mode: ${value}. Use code|prose|extracted-prose|records.`);
  }
  return mode;
};

const resolveIndexDirFromInput = ({ repo, indexRoot, crashBundle, mode }) => {
  if (indexRoot) {
    const resolved = path.resolve(indexRoot);
    if (path.basename(resolved).toLowerCase() === `index-${mode}`) {
      return resolved;
    }
    return path.join(resolved, `index-${mode}`);
  }
  if (crashBundle) {
    const bundle = JSON.parse(fs.readFileSync(path.resolve(crashBundle), 'utf8'));
    const repoCacheRoot = bundle?.runtime?.repoCacheRoot || bundle?.repoCacheRoot || null;
    if (!repoCacheRoot) {
      throw new Error(`Crash bundle missing repoCacheRoot: ${crashBundle}`);
    }
    return path.join(repoCacheRoot, `index-${mode}`);
  }
  const { repoRoot, userConfig } = resolveRepoConfig(repo);
  return getIndexDir(repoRoot, mode, userConfig);
};

export async function runReconcileIdentityCli(rawArgv = process.argv.slice(2)) {
  const argv = createCli({
    scriptName: 'reconcile-identity',
    options: {
      json: { type: 'boolean', default: false },
      repo: { type: 'string' },
      mode: { type: 'string', default: 'code' },
      'index-root': { type: 'string' },
      'crash-bundle': { type: 'string' },
      strict: { type: 'boolean', default: true },
      'non-strict': { type: 'boolean', default: false }
    }
  }).parse(rawArgv);
  if (argv.strict && argv['non-strict']) {
    throw new Error('Choose either --strict or --non-strict, not both.');
  }
  const mode = normalizeMode(argv.mode);
  const strict = argv['non-strict'] ? false : argv.strict !== false;
  const indexDir = resolveIndexDirFromInput({
    repo: argv.repo,
    indexRoot: argv['index-root'],
    crashBundle: argv['crash-bundle'],
    mode
  });
  const report = await reconcileIndexIdentity({
    indexDir,
    mode,
    strict
  });
  if (argv.json) {
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }

  console.error('Identity reconciliation');
  console.error(`- mode: ${report.mode}`);
  console.error(`- strict: ${report.strict ? 'yes' : 'no'}`);
  console.error(`- index: ${report.indexDir}`);
  console.error(
    `- counts: chunk_meta ${report.counts.chunkMeta}, symbols ${report.counts.symbols}, `
    + `symbol_occurrences ${report.counts.symbolOccurrences}, symbol_edges ${report.counts.symbolEdges}, `
    + `chunk_uid_map ${report.counts.chunkUidMap}`
  );
  console.error(`- summary: chunkUids ${report.summary.chunkUidCount}, docIds ${report.summary.docIdCount}`);
  if (report.issues.length) {
    console.error('Issues:');
    for (const issue of report.issues) {
      console.error(`- [${issue.code}] ${issue.message}`);
    }
    if (report.totalIssues > report.issues.length) {
      console.error(`- ... ${report.totalIssues - report.issues.length} additional issue(s) omitted`);
    }
  } else {
    console.error('- issues: none');
  }
  return report.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runReconcileIdentityCli().then((code) => {
    process.exit(code);
  }).catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
