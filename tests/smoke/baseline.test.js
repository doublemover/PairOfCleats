#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../src/shared/cli.js';
import { getDictionaryPaths, getDictConfig, getIndexDir, loadUserConfig, resolveSqlitePaths } from '../../tools/shared/dict-utils.js';
import { normalizePostingsConfig } from '../../src/shared/postings-config.js';
import { getVectorExtensionConfig, resolveVectorExtensionPath } from '../../tools/sqlite/vector-extension.js';
import { REQUIRED_TABLES } from '../../src/storage/sqlite/schema.js';
import { createBaselinePrerequisites } from '../helpers/baseline-prerequisites.js';

const requested = createCli({
  scriptName: 'verify',
  options: {
    'require-index': { type: 'boolean', default: false },
    'require-sqlite': { type: 'boolean', default: false },
    'require-dicts': { type: 'boolean', default: false }
  }
}).parse();

const indexFiles = ['chunk_meta.json', 'token_postings.json', 'phrase_ngrams.json',
  'chargram_postings.json', 'minhash_signatures.json'];
// Explicit requirements retain the standalone workspace diagnostic. The
// discovered default case must own its prerequisites and assert its negatives.
const explicit = process.argv.slice(2).some(arg => /^--(?:no-)?require-(?:index|sqlite|dicts)(?:=|$)/.test(arg));
const fixture = explicit ? null : await createBaselinePrerequisites(process.cwd(), fileURLToPath(import.meta.url), indexFiles);
const root = fixture?.root || process.cwd();
const argv = fixture ? { 'require-index': true, 'require-sqlite': true, 'require-dicts': true } : requested;
try {
  let failures = 0;
  const warnings = [];
  const report = (ok, msg) => {
    const prefix = ok ? 'ok' : 'fail';
    console.log(`[${prefix}] ${msg}`);
    if (!ok) failures += 1;
  };
  const warn = (msg) => { warnings.push(msg); console.log(`[warn] ${msg}`); };

  report(fs.existsSync(path.join(root, 'package.json')), 'package.json present');
  report(fs.existsSync(path.join(root, 'build_index.js')), 'build_index.js present');
  report(fs.existsSync(path.join(root, 'search.js')), 'search.js present');

  const configPath = path.join(root, '.pairofcleats.json');
  report(fs.existsSync(configPath), '.pairofcleats.json present');

  const userConfig = loadUserConfig(root);
  const postingsConfig = normalizePostingsConfig(userConfig.indexing?.postings || {});
  const vectorExtension = getVectorExtensionConfig(root, userConfig);
  const dictConfig = getDictConfig(root, userConfig);
  const dictionaryPaths = await getDictionaryPaths(root, dictConfig, { allowFallback: false });
  if (dictionaryPaths.length) {
    report(true, `dictionary files found (${dictionaryPaths.length})`);
  } else if (argv['require-dicts']) {
    report(false, 'dictionary files not found');
  } else {
    warn('dictionary files not found (run node tools/download/dicts.js --lang en)');
  }

  const indexDirs = [
    { name: getIndexDir(root, 'code', userConfig), required: argv['require-index'] },
    { name: getIndexDir(root, 'prose', userConfig), required: argv['require-index'] }
  ];
  const requiredIndexFiles = [
    'chunk_meta.json',
    'token_postings.json',
    ...(postingsConfig.enablePhraseNgrams !== false ? ['phrase_ngrams.json'] : []),
    ...(postingsConfig.enableChargrams !== false ? ['chargram_postings.json'] : []),
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
    for (const file of requiredIndexFiles) {
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
      for (const target of sqliteTargets) {
        if (!fs.existsSync(target.path)) continue;
        const db = new Database(target.path, { readonly: true });
        try {
          const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
          const tableNames = new Set(rows.map((row) => row.name));
          const missing = REQUIRED_TABLES.filter((name) => !tableNames.has(name));
          if (missing.length) {
            const msg = `sqlite ${target.label} index missing tables (${missing.join(', ')})`;
            if (argv['require-sqlite']) report(false, msg);
            else warn(msg);
          } else {
            report(true, `sqlite ${target.label} tables present`);
          }
        } finally { db.close(); }
      }
    } catch (err) {
      const reason = err?.message || 'better-sqlite3 unavailable';
      if (argv['require-sqlite']) report(false, `sqlite table check failed (${reason})`);
      else warn(`sqlite table check skipped (${reason})`);
    }
  }

  if (failures) {
    console.error(`\n${failures} checks failed`);
    if (fixture) throw new Error('Fresh baseline prerequisites must pass');
    process.exitCode = 1;
  } else {
    console.log('\nAll required checks passed');
  }

  if (fixture) {
    assert.deepEqual(warnings, [], 'the healthy baseline must not hide warnings');
    await fixture.verifyNegatives();
    console.log('Baseline prerequisites assert fresh, restored, missing, corrupt, incomplete and legacy states');
  }
} finally { await fixture?.cleanup(); }
