#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import minimist from 'minimist';
import { getDictionaryPaths, getDictConfig, getIndexDir, loadUserConfig, resolveSqlitePaths } from '../tools/dict-utils.js';
import { getVectorExtensionConfig, resolveVectorExtensionPath } from '../tools/vector-extension.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['require-index', 'require-sqlite', 'require-dicts'],
  default: {
    'require-index': false,
    'require-sqlite': false,
    'require-dicts': false
  }
});

const root = process.cwd();
let failures = 0;
const report = (ok, msg) => {
  const prefix = ok ? 'ok' : 'fail';
  console.log(`[${prefix}] ${msg}`);
  if (!ok) failures += 1;
};
const warn = (msg) => console.log(`[warn] ${msg}`);

report(fs.existsSync(path.join(root, 'package.json')), 'package.json present');
report(fs.existsSync(path.join(root, 'build_index.js')), 'build_index.js present');
report(fs.existsSync(path.join(root, 'search.js')), 'search.js present');

const configPath = path.join(root, '.pairofcleats.json');
report(fs.existsSync(configPath), '.pairofcleats.json present');

const userConfig = loadUserConfig(root);
const vectorExtension = getVectorExtensionConfig(root, userConfig);
const dictConfig = getDictConfig(root, userConfig);
const dictionaryPaths = await getDictionaryPaths(root, dictConfig);
if (dictionaryPaths.length) {
  report(true, `dictionary files found (${dictionaryPaths.length})`);
} else if (argv['require-dicts']) {
  report(false, 'dictionary files not found');
} else {
  warn('dictionary files not found (run npm run download-dicts -- --lang en)');
}

const indexDirs = [
  { name: getIndexDir(root, 'code', userConfig), required: argv['require-index'] },
  { name: getIndexDir(root, 'prose', userConfig), required: argv['require-index'] }
];
const indexFiles = [
  'chunk_meta.json',
  'token_postings.json',
  'phrase_ngrams.json',
  'chargram_postings.json',
  'minhash_signatures.json'
];

for (const dir of indexDirs) {
  const dirPath = dir.name;
  if (!fs.existsSync(dirPath)) {
    const display = path.relative(root, dirPath) || dirPath;
    if (dir.required) report(false, `${display} missing`);
    else warn(`${display} missing (build index to generate)`);
    continue;
  }
  for (const file of indexFiles) {
    const filePath = path.join(dirPath, file);
    const displayPath = path.relative(root, filePath) || filePath;
    if (fs.existsSync(filePath)) report(true, `${displayPath} present`);
    else if (dir.required) report(false, `${displayPath} missing`);
    else warn(`${displayPath} missing`);
  }
}

const sqlitePaths = resolveSqlitePaths(root, userConfig);
if (vectorExtension.enabled) {
  const extPath = resolveVectorExtensionPath(vectorExtension);
  if (extPath && fs.existsSync(extPath)) {
    report(true, `sqlite ann extension present (${extPath})`);
  } else if (argv['require-sqlite']) {
    report(false, 'sqlite ann extension missing (configured)');
  } else {
    warn('sqlite ann extension missing (configured)');
  }
}
const sqliteTargets = [
  { label: 'code', path: sqlitePaths.codePath },
  { label: 'prose', path: sqlitePaths.prosePath }
];

let sqlitePresent = false;
for (const target of sqliteTargets) {
  if (fs.existsSync(target.path)) {
    sqlitePresent = true;
    report(true, `sqlite index present (${target.label}: ${target.path})`);
  } else if (argv['require-sqlite']) {
    report(false, `sqlite index missing (${target.label}: ${target.path})`);
  } else {
    warn(`sqlite index missing (${target.label}: ${target.path})`);
  }
}

if (sqlitePaths.legacyExists) {
  const msg = `legacy sqlite index detected (${sqlitePaths.legacyPath})`;
  report(false, msg);
}

if (sqlitePresent) {
  try {
    const { default: Database } = await import('better-sqlite3');
    const requiredTables = [
      'chunks',
      'chunks_fts',
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
      'dense_meta',
      'file_manifest'
    ];
    for (const target of sqliteTargets) {
      if (!fs.existsSync(target.path)) continue;
      const db = new Database(target.path, { readonly: true });
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      const tableNames = new Set(rows.map((row) => row.name));
      const missing = requiredTables.filter((name) => !tableNames.has(name));
      if (missing.length) {
        const msg = `sqlite ${target.label} index missing tables (${missing.join(', ')})`;
        if (argv['require-sqlite']) report(false, msg);
        else warn(msg);
      } else {
        report(true, `sqlite ${target.label} tables present`);
      }
      db.close();
    }
  } catch (err) {
    warn(`sqlite table check skipped (${err?.message || 'better-sqlite3 unavailable'})`);
  }
}

if (failures) {
  console.error(`\n${failures} checks failed`);
  process.exit(1);
}

console.log('\nAll required checks passed');
