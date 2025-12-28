#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import minimist from 'minimist';
import simpleGit from 'simple-git';
import { getIndexDir, loadUserConfig, resolveSqlitePaths } from './dict-utils.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['skip-build', 'skip-sqlite', 'incremental'],
  string: ['out'],
  default: {
    'skip-build': false,
    'skip-sqlite': false,
    'incremental': false
  }
});

const root = process.cwd();
const userConfig = loadUserConfig(root);
const outDir = argv.out ? path.resolve(argv.out) : path.join(root, 'ci-artifacts');
const codeDir = getIndexDir(root, 'code', userConfig);
const proseDir = getIndexDir(root, 'prose', userConfig);
const sqlitePaths = resolveSqlitePaths(root, userConfig);

function run(cmd, args, label) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label || cmd}`);
    process.exit(result.status ?? 1);
  }
}

if (!argv['skip-build']) {
  const args = ['build_index.js'];
  if (argv.incremental) args.push('--incremental');
  run(process.execPath, args, 'build index');
}

if (!argv['skip-sqlite']) {
  const args = [path.join('tools', 'build-sqlite-index.js')];
  if (argv.incremental) args.push('--incremental');
  run(process.execPath, args, 'build sqlite index');
}

await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

async function copyDir(src, dest) {
  if (!fs.existsSync(src)) return false;
  await fsPromises.mkdir(dest, { recursive: true });
  await fsPromises.cp(src, dest, { recursive: true });
  return true;
}

const copied = {
  code: await copyDir(codeDir, path.join(outDir, 'index-code')),
  prose: await copyDir(proseDir, path.join(outDir, 'index-prose')),
  sqlite: {
    code: false,
    prose: false
  }
};

if (!copied.code || !copied.prose) {
  console.error('Index artifacts missing; build indexes before exporting.');
  process.exit(1);
}

if (!argv['skip-sqlite']) {
  const sqliteDestDir = path.join(outDir, 'index-sqlite');
  await fsPromises.mkdir(sqliteDestDir, { recursive: true });
  const codeExists = fs.existsSync(sqlitePaths.codePath);
  const proseExists = fs.existsSync(sqlitePaths.prosePath);
  if (codeExists) {
    await fsPromises.copyFile(sqlitePaths.codePath, path.join(sqliteDestDir, 'index-code.db'));
    copied.sqlite.code = true;
  }
  if (proseExists) {
    await fsPromises.copyFile(sqlitePaths.prosePath, path.join(sqliteDestDir, 'index-prose.db'));
    copied.sqlite.prose = true;
  }
  if (!codeExists || !proseExists) {
    console.warn('SQLite index missing (code or prose); skipping missing sqlite artifacts.');
  }
  if (sqlitePaths.legacyExists) {
    console.warn(`Legacy sqlite index detected (ignored): ${sqlitePaths.legacyPath}`);
  }
}

const git = simpleGit({ baseDir: root });
let commit = null;
let dirty = null;
let remote = null;
try {
  commit = (await git.revparse(['HEAD'])).trim();
  dirty = !(await git.status()).isClean();
  const remotes = await git.getRemotes(true);
  const origin = remotes.find((r) => r.name === 'origin') || remotes[0];
  remote = origin?.refs?.fetch || null;
} catch {
  commit = null;
  dirty = null;
  remote = null;
}

const manifest = {
  version: 3,
  generatedAt: new Date().toISOString(),
  repo: {
    remote,
    root: path.resolve(root)
  },
  commit,
  dirty,
  artifacts: {
    code: copied.code ? 'index-code' : null,
    prose: copied.prose ? 'index-prose' : null,
    sqlite: {
      code: copied.sqlite.code ? 'index-sqlite/index-code.db' : null,
      prose: copied.sqlite.prose ? 'index-sqlite/index-prose.db' : null
    }
  }
};

await fsPromises.writeFile(
  path.join(outDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);

console.log(`CI artifacts written to ${outDir}`);
