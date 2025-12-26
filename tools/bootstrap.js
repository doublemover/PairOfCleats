#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import minimist from 'minimist';
import { getDictionaryPaths, getDictConfig, loadUserConfig } from './dict-utils.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['skip-install', 'skip-dicts', 'skip-index', 'with-sqlite'],
  alias: { s: 'with-sqlite' },
  default: {
    'skip-install': false,
    'skip-dicts': false,
    'skip-index': false,
    'with-sqlite': false
  }
});

const root = process.cwd();
const userConfig = loadUserConfig(root);

function run(cmd, args, label) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label || cmd}`);
    process.exit(result.status ?? 1);
  }
}

if (!argv['skip-install']) {
  const nodeModules = path.join(root, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    run('npm', ['install'], 'npm install');
  }
}

if (!argv['skip-dicts']) {
  const dictConfig = getDictConfig(root, userConfig);
  const englishPath = path.join(dictConfig.dir, 'en.txt');
  if (!fs.existsSync(englishPath)) {
    run(process.execPath, [path.join('tools', 'download-dicts.js'), '--lang', 'en'], 'download English dictionary');
  }
  const dictionaryPaths = await getDictionaryPaths(root, dictConfig);
  if (dictionaryPaths.length) {
    console.log(`[bootstrap] Wordlists enabled (${dictionaryPaths.length} file(s)).`);
  } else {
    console.warn('[bootstrap] No wordlists found; identifier splitting will be limited.');
  }
}

if (!argv['skip-index']) {
  run(process.execPath, ['build_index.js'], 'build index');
}

if (argv['with-sqlite']) {
  run(process.execPath, [path.join('tools', 'build-sqlite-index.js')], 'build sqlite index');
}

console.log('\nBootstrap complete.');
