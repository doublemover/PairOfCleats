#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import minimist from 'minimist';
import simpleGit from 'simple-git';
import { getIndexDir, loadUserConfig, resolveSqlitePaths } from './dict-utils.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['force'],
  string: ['from'],
  default: { force: false }
});

const root = process.cwd();
const fromDir = argv.from ? path.resolve(argv.from) : path.join(root, 'ci-artifacts');
const manifestPath = path.join(fromDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`manifest.json not found in ${fromDir}`);
  process.exit(1);
}

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch {
  console.error(`Failed to read ${manifestPath}`);
  process.exit(1);
}

let commitMatch = true;
try {
  const git = simpleGit({ baseDir: root });
  const commit = (await git.revparse(['HEAD'])).trim();
  if (manifest.commit && commit && manifest.commit !== commit) {
    commitMatch = false;
  }
} catch {
  commitMatch = !manifest.commit;
}

if (!commitMatch && !argv.force) {
  console.error('CI artifacts do not match current commit (use --force to override).');
  process.exit(1);
}

const userConfig = loadUserConfig(root);
const codeDir = getIndexDir(root, 'code', userConfig);
const proseDir = getIndexDir(root, 'prose', userConfig);
const sqlitePaths = resolveSqlitePaths(root, userConfig);

/**
 * Copy a directory from the artifact bundle into the repo cache.
 * @param {string} src
 * @param {string} dest
 * @returns {Promise<boolean>}
 */
async function copyDir(src, dest) {
  if (!fs.existsSync(src)) return false;
  await fsPromises.rm(dest, { recursive: true, force: true });
  await fsPromises.mkdir(dest, { recursive: true });
  await fsPromises.cp(src, dest, { recursive: true });
  return true;
}

const copied = {
  code: await copyDir(path.join(fromDir, 'index-code'), codeDir),
  prose: await copyDir(path.join(fromDir, 'index-prose'), proseDir),
  sqlite: {
    code: false,
    prose: false
  }
};

const sqliteSourceDir = path.join(fromDir, 'index-sqlite');
const sqliteCodeSource = path.join(sqliteSourceDir, 'index-code.db');
const sqliteProseSource = path.join(sqliteSourceDir, 'index-prose.db');
const sqliteLegacySource = path.join(sqliteSourceDir, 'index.db');
if (fs.existsSync(sqliteCodeSource)) {
  await fsPromises.mkdir(path.dirname(sqlitePaths.codePath), { recursive: true });
  await fsPromises.copyFile(sqliteCodeSource, sqlitePaths.codePath);
  copied.sqlite.code = true;
}
if (fs.existsSync(sqliteProseSource)) {
  await fsPromises.mkdir(path.dirname(sqlitePaths.prosePath), { recursive: true });
  await fsPromises.copyFile(sqliteProseSource, sqlitePaths.prosePath);
  copied.sqlite.prose = true;
}
if (fs.existsSync(sqliteLegacySource)) {
  console.warn(`Legacy sqlite artifact detected and ignored: ${sqliteLegacySource}`);
}

if (!copied.code || !copied.prose) {
  console.error('Required index artifacts are missing (code or prose).');
  process.exit(1);
}

console.log('CI artifacts restored');
console.log(`- code index: ${copied.code ? 'ok' : 'missing'}`);
console.log(`- prose index: ${copied.prose ? 'ok' : 'missing'}`);
console.log(`- sqlite code index: ${copied.sqlite.code ? 'ok' : 'missing'}`);
console.log(`- sqlite prose index: ${copied.sqlite.prose ? 'ok' : 'missing'}`);
