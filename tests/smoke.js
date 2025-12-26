#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import minimist from 'minimist';
import { getDictionaryPaths, getDictConfig, getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

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

const sqliteConfig = userConfig.sqlite || {};
const defaultDbPath = sqliteConfig.dbPath
  ? path.resolve(sqliteConfig.dbPath)
  : path.join(root, 'index-sqlite', 'index.db');

if (fs.existsSync(defaultDbPath)) {
  report(true, `sqlite index present (${defaultDbPath})`);
} else if (argv['require-sqlite']) {
  report(false, `sqlite index missing (${defaultDbPath})`);
} else {
  warn(`sqlite index missing (${defaultDbPath})`);
}

if (failures) {
  console.error(`\n${failures} checks failed`);
  process.exit(1);
}

console.log('\nAll required checks passed');
