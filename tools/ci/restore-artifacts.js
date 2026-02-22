#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { getIndexDir, resolveRepoConfig, resolveSqlitePaths } from '../shared/dict-utils.js';
import { checksumFile, sha1File } from '../../src/shared/hash.js';
import { fromPosix, isAbsolutePathNative, toPosix } from '../../src/shared/files.js';
import { copyDirIfExists } from '../shared/fs-utils.js';
import { readRepoGitState } from '../shared/git-state.js';
import { readJsonFileSyncSafe } from '../shared/json-utils.js';

const argv = createCli({
  scriptName: 'ci-restore',
  options: {
    force: { type: 'boolean', default: false },
    from: { type: 'string' },
    repo: { type: 'string' }
  }
}).parse();

const { repoRoot: root, userConfig } = resolveRepoConfig(argv.repo);
const fromDir = argv.from ? path.resolve(argv.from) : path.join(root, 'ci-artifacts');
const manifestPath = path.join(fromDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`manifest.json not found in ${fromDir}`);
  process.exit(1);
}

const MANIFEST_PARSE_FAILED = Symbol('manifestParseFailed');
const manifest = readJsonFileSyncSafe(manifestPath, MANIFEST_PARSE_FAILED);
if (manifest === MANIFEST_PARSE_FAILED) {
  console.error(`Failed to read ${manifestPath}`);
  process.exit(1);
}

const gitState = await readRepoGitState(root);
const commitMatch = !manifest.commit || (Boolean(gitState.head) && manifest.commit === gitState.head);

if (!commitMatch && !argv.force) {
  console.error('CI artifacts do not match current commit (use --force to override).');
  process.exit(1);
}

const codeDir = getIndexDir(root, 'code', userConfig);
const proseDir = getIndexDir(root, 'prose', userConfig);
const sqlitePaths = resolveSqlitePaths(root, userConfig);

const parseChecksum = (value) => {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split(':');
  if (parts.length === 2) return { algo: parts[0], value: parts[1] };
  return { algo: 'xxh64', value };
};

const isSafeManifestPath = (value) => {
  if (typeof value !== 'string' || !value) return false;
  if (isAbsolutePathNative(value)) return false;
  const normalized = toPosix(value);
  if (normalized.startsWith('/')) return false;
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..')) return false;
  return true;
};

const resolveManifestPath = (indexDir, relPath) => {
  if (!isSafeManifestPath(relPath)) {
    throw new Error(`Unsafe manifest path for ${relPath}`);
  }
  const resolved = path.resolve(indexDir, fromPosix(relPath));
  const root = path.resolve(indexDir);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || isAbsolutePathNative(relative)) {
    throw new Error(`Manifest path escapes index root: ${relPath}`);
  }
  return resolved;
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
    const absPath = resolveManifestPath(indexDir, piece.path);
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
  code: await copyDirIfExists(path.join(fromDir, 'index-code'), codeDir, { clearDestination: true }),
  prose: await copyDirIfExists(path.join(fromDir, 'index-prose'), proseDir, { clearDestination: true }),
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
