#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { getIndexDir, loadUserConfig, resolveRepoRoot, resolveSqlitePaths } from './dict-utils.js';
import { normalizePostingsConfig } from '../src/shared/postings-config.js';

const argv = createCli({
  scriptName: 'index-validate',
  options: {
    json: { type: 'boolean', default: false },
    repo: { type: 'string' },
    mode: { type: 'string' }
  }
}).parse();

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const root = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(root);
const postingsConfig = normalizePostingsConfig(userConfig.indexing?.postings || {});

const parseModes = (raw) => {
  const tokens = String(raw || '').split(/[,\s]+/).map((token) => token.trim()).filter(Boolean);
  const modeSet = new Set(tokens.length ? tokens : ['code', 'prose']);
  if (modeSet.has('all')) return ['code', 'prose', 'records'];
  return Array.from(modeSet);
};

const resolveIndexDir = (mode) => {
  const cached = getIndexDir(root, mode, userConfig);
  const cachedMeta = path.join(cached, 'chunk_meta.json');
  const cachedMetaJsonl = path.join(cached, 'chunk_meta.jsonl');
  const cachedMetaParts = path.join(cached, 'chunk_meta.meta.json');
  if (fs.existsSync(cachedMeta) || fs.existsSync(cachedMetaJsonl) || fs.existsSync(cachedMetaParts)) {
    return cached;
  }
  const local = path.join(root, `index-${mode}`);
  const localMeta = path.join(local, 'chunk_meta.json');
  const localMetaJsonl = path.join(local, 'chunk_meta.jsonl');
  const localMetaParts = path.join(local, 'chunk_meta.meta.json');
  if (fs.existsSync(localMeta) || fs.existsSync(localMetaJsonl) || fs.existsSync(localMetaParts)) {
    return local;
  }
  return cached;
};

const modes = parseModes(argv.mode);
const report = {
  ok: true,
  root: path.resolve(root),
  modes: {},
  sqlite: { enabled: userConfig.sqlite?.use !== false },
  issues: [],
  warnings: []
};

const requiredFiles = ['chunk_meta', 'token_postings'];
if (postingsConfig.enablePhraseNgrams) requiredFiles.push('phrase_ngrams.json');
if (postingsConfig.enableChargrams) requiredFiles.push('chargram_postings.json');
if (postingsConfig.fielded) {
  requiredFiles.push('field_postings.json');
  requiredFiles.push('field_tokens.json');
}
const optionalFiles = [
  'minhash_signatures.json',
  'file_relations.json',
  'file_meta.json',
  'repo_map.json',
  'filter_index.json'
];
if (userConfig.search?.annDefault !== false) {
  optionalFiles.push('dense_vectors_uint8.json');
  optionalFiles.push('dense_vectors_doc_uint8.json');
  optionalFiles.push('dense_vectors_code_uint8.json');
}

for (const mode of modes) {
  const dir = resolveIndexDir(mode);
  const modeReport = {
    path: path.resolve(dir),
    ok: true,
    missing: [],
    warnings: []
  };
  const hasArtifact = (file) => {
    if (file === 'chunk_meta') {
      const json = path.join(dir, 'chunk_meta.json');
      const jsonl = path.join(dir, 'chunk_meta.jsonl');
      const meta = path.join(dir, 'chunk_meta.meta.json');
      const partsDir = path.join(dir, 'chunk_meta.parts');
      return fs.existsSync(json) || fs.existsSync(jsonl) || fs.existsSync(meta) || fs.existsSync(partsDir);
    }
    if (file === 'token_postings') {
      const json = path.join(dir, 'token_postings.json');
      const meta = path.join(dir, 'token_postings.meta.json');
      const shardsDir = path.join(dir, 'token_postings.shards');
      return fs.existsSync(json) || fs.existsSync(meta) || fs.existsSync(shardsDir);
    }
    const filePath = path.join(dir, file);
    if (fs.existsSync(filePath)) return true;
    if (file.endsWith('.json')) {
      const gzPath = `${filePath}.gz`;
      if (fs.existsSync(gzPath)) return true;
    }
    return false;
  };
  for (const file of requiredFiles) {
    if (!hasArtifact(file)) {
      modeReport.ok = false;
      modeReport.missing.push(file);
      report.issues.push(`[${mode}] missing ${file}`);
    }
  }
  for (const file of optionalFiles) {
    if (!hasArtifact(file)) {
      modeReport.warnings.push(file);
      report.warnings.push(`[${mode}] optional ${file} missing`);
    }
  }
  report.modes[mode] = modeReport;
}

const sqlitePaths = resolveSqlitePaths(root, userConfig);
const sqliteMode = userConfig.sqlite?.scoreMode === 'fts' ? 'fts' : 'bm25';
const sqliteRequiredTables = sqliteMode === 'fts'
  ? ['chunks', 'chunks_fts', 'minhash_signatures', 'dense_vectors', 'dense_meta']
  : [
    'chunks',
    'token_vocab',
    'token_postings',
    'doc_lengths',
    'token_stats',
    'phrase_vocab',
    'phrase_postings',
    'chargram_vocab',
    'chargram_postings',
    'minhash_signatures',
    'dense_vectors',
    'dense_meta'
  ];

const sqliteReport = {
  enabled: report.sqlite.enabled,
  mode: sqliteMode,
  ok: true,
  code: sqlitePaths.codePath,
  prose: sqlitePaths.prosePath,
  issues: []
};

if (sqliteReport.enabled) {
  const sqliteIssues = [];
  if (!fs.existsSync(sqlitePaths.codePath)) sqliteIssues.push('code db missing');
  if (!fs.existsSync(sqlitePaths.prosePath)) sqliteIssues.push('prose db missing');
  if (sqliteIssues.length) {
    sqliteReport.ok = false;
    sqliteReport.issues.push(...sqliteIssues);
    sqliteIssues.forEach((issue) => report.issues.push(`[sqlite] ${issue}`));
  } else {
    let Database;
    try {
      ({ default: Database } = await import('better-sqlite3'));
    } catch {
      sqliteReport.ok = false;
      const issue = 'better-sqlite3 not available';
      sqliteReport.issues.push(issue);
      report.issues.push(`[sqlite] ${issue}`);
    }
    if (Database) {
      const checkTables = (dbPath, label) => {
        const db = new Database(dbPath, { readonly: true });
        try {
          const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
          const tableNames = new Set(rows.map((row) => row.name));
          const missing = sqliteRequiredTables.filter((name) => !tableNames.has(name));
          if (missing.length) {
            sqliteReport.ok = false;
            const issue = `${label} missing tables: ${missing.join(', ')}`;
            sqliteReport.issues.push(issue);
            report.issues.push(`[sqlite] ${issue}`);
          }
        } finally {
          db.close();
        }
      };
      checkTables(sqlitePaths.codePath, 'code');
      checkTables(sqlitePaths.prosePath, 'prose');
    }
  }
}

report.sqlite = sqliteReport;
report.ok = report.issues.length === 0;

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
  console.log(`- sqlite: ${status} (mode=${sqliteReport.mode})`);
  if (sqliteReport.issues.length) {
    sqliteReport.issues.forEach((issue) => console.log(`  - ${issue}`));
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
process.exit(report.ok ? 0 : 1);
