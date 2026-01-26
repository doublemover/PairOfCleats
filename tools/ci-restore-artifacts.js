#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import simpleGit from 'simple-git';
import { getIndexDir, loadUserConfig, resolveRepoRoot, resolveSqlitePaths } from './dict-utils.js';
import { checksumFile, sha1File } from '../src/shared/hash.js';

const argv = createCli({
  scriptName: 'ci-restore',
  options: {
    force: { type: 'boolean', default: false },
    from: { type: 'string' },
    repo: { type: 'string' }
  }
}).parse();

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const root = rootArg || resolveRepoRoot(process.cwd());
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

const parseChecksum = (value) => {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split(':');
  if (parts.length === 2) return { algo: parts[0], value: parts[1] };
  return { algo: 'xxh64', value };
};

async function validatePiecesManifest(indexDir, label) {
  const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;
  let manifest = null;
  try {
    manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to read pieces manifest for ${label}: ${err?.message || err}`);
  }
  const fields = manifest?.fields || manifest || {};
  const pieces = Array.isArray(fields.pieces) ? fields.pieces : [];
  for (const piece of pieces) {
    if (!piece?.path) continue;
    const parsed = parseChecksum(piece.checksum);
    if (!parsed?.value) continue;
    const absPath = path.join(indexDir, piece.path.split('/').join(path.sep));
    if (!fs.existsSync(absPath)) {
      throw new Error(`Missing artifact ${piece.path} for ${label}`);
    }
    let expected = null;
    if (parsed.algo === 'sha1') {
      expected = await sha1File(absPath);
    } else {
      const result = await checksumFile(absPath);
      expected = result?.value || null;
    }
    if (!expected || expected !== parsed.value) {
      throw new Error(`Checksum mismatch for ${piece.path} (${label})`);
    }
  }
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

try {
  await validatePiecesManifest(codeDir, 'code');
  await validatePiecesManifest(proseDir, 'prose');
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
}

console.error('CI artifacts restored');
console.error(`- code index: ${copied.code ? 'ok' : 'missing'}`);
console.error(`- prose index: ${copied.prose ? 'ok' : 'missing'}`);
console.error(`- sqlite code index: ${copied.sqlite.code ? 'ok' : 'missing'}`);
console.error(`- sqlite prose index: ${copied.sqlite.prose ? 'ok' : 'missing'}`);
