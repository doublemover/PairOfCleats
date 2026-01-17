#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCli } from '../src/shared/cli.js';
import { createDisplay } from '../src/shared/cli/display.js';
import simpleGit from 'simple-git';
import { getIndexDir, getRuntimeConfig, loadUserConfig, resolveRepoRoot, resolveRuntimeEnv, resolveSqlitePaths, resolveToolRoot } from './dict-utils.js';

const argv = createCli({
  scriptName: 'ci-build',
  options: {
    'skip-build': { type: 'boolean', default: false },
    'skip-sqlite': { type: 'boolean', default: false },
    incremental: { type: 'boolean', default: false },
    out: { type: 'string' },
    repo: { type: 'string' },
    progress: { type: 'string', default: 'auto' },
    verbose: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false }
  }
}).parse();

const display = createDisplay({
  stream: process.stderr,
  progressMode: argv.progress,
  verbose: argv.verbose === true,
  quiet: argv.quiet === true
});
const logger = {
  log: (message) => display.log(message),
  warn: (message) => display.warn(message),
  error: (message) => display.error(message)
};
const totalSteps = (argv['skip-build'] ? 0 : 1) + (argv['skip-sqlite'] ? 0 : 1) + 1;
let stepIndex = 0;
const updateProgress = (message) => {
  display.showProgress('CI', stepIndex, totalSteps, { stage: 'ci', message });
};

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const root = rootArg || resolveRepoRoot(process.cwd());
const scriptRoot = resolveToolRoot();
const userConfig = loadUserConfig(root);
const runtimeConfig = getRuntimeConfig(root, userConfig);
const baseEnv = resolveRuntimeEnv(runtimeConfig, process.env);
const outDir = argv.out ? path.resolve(argv.out) : path.join(root, 'ci-artifacts');
const codeDir = getIndexDir(root, 'code', userConfig);
const proseDir = getIndexDir(root, 'prose', userConfig);
const sqlitePaths = resolveSqlitePaths(root, userConfig);

/**
 * Run a command and exit on failure.
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} label
 */
function run(cmd, args, label) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', env: baseEnv });
  if (result.status !== 0) {
    logger.error(`Failed: ${label || cmd}`);
    display.close();
    process.exit(result.status ?? 1);
  }
}

if (!argv['skip-build']) {
  const childProgress = argv.verbose ? (argv.progress || 'auto') : 'off';
  const args = [
    path.join(scriptRoot, 'build_index.js'),
    '--repo',
    root,
    '--progress',
    childProgress
  ];
  if (argv.incremental) args.push('--incremental');
  if (argv.verbose) args.push('--verbose');
  if (argv.quiet) args.push('--quiet');
  updateProgress('build index');
  run(process.execPath, args, 'build index');
  stepIndex += 1;
}

if (!argv['skip-sqlite']) {
  const childProgress = argv.verbose ? (argv.progress || 'auto') : 'off';
  const args = [
    path.join(scriptRoot, 'tools', 'build-sqlite-index.js'),
    '--repo',
    root,
    '--progress',
    childProgress
  ];
  if (argv.incremental) args.push('--incremental');
  if (argv.verbose) args.push('--verbose');
  if (argv.quiet) args.push('--quiet');
  updateProgress('build sqlite');
  run(process.execPath, args, 'build sqlite index');
  stepIndex += 1;
}

updateProgress('pack artifacts');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

/**
 * Copy a directory if it exists.
 * @param {string} src
 * @param {string} dest
 * @returns {Promise<boolean>}
 */
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
  logger.error('Index artifacts missing; build indexes before exporting.');
  display.close();
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
    logger.warn('SQLite index missing (code or prose); skipping missing sqlite artifacts.');
  }
  if (sqlitePaths.legacyExists) {
    logger.warn(`Legacy sqlite index detected (ignored): ${sqlitePaths.legacyPath}`);
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

stepIndex += 1;
display.showProgress('CI', stepIndex, totalSteps, { stage: 'ci', message: 'complete' });
logger.log(`CI artifacts written to ${outDir}`);
display.close();
