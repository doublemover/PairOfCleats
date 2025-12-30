#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'git-hooks');
const repoRoot = path.join(tempRoot, 'repo');

const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (gitCheck.status !== 0) {
  console.log('[skip] git not available');
  process.exit(0);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

const init = spawnSync('git', ['init'], { cwd: repoRoot, encoding: 'utf8' });
if (init.status !== 0) {
  console.error('git init failed');
  process.exit(init.status ?? 1);
}

const hookScript = path.join(root, 'tools', 'git-hooks.js');
const run = (args, label) => {
  const result = spawnSync(process.execPath, [hookScript, ...args], { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
};

run(['--install'], 'git-hooks install');

const hookPath = path.join(repoRoot, '.git', 'hooks', 'post-commit');
if (!fs.existsSync(hookPath)) {
  console.error('post-commit hook not installed');
  process.exit(1);
}
const contents = fs.readFileSync(hookPath, 'utf8');
if (!contents.includes('PairOfCleats hook')) {
  console.error('post-commit hook missing marker');
  process.exit(1);
}

run(['--uninstall'], 'git-hooks uninstall');
if (fs.existsSync(hookPath)) {
  console.error('post-commit hook not removed');
  process.exit(1);
}

console.log('git hooks test passed');
