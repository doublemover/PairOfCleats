#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'cache-gc');
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(cacheRoot, 'repos');
const toolPath = path.join(root, 'tools', 'cache-gc.js');

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot
};

const makeRepo = async (name, bytes, mtimeMs) => {
  const repoPath = path.join(repoRoot, name);
  await fsPromises.mkdir(repoPath, { recursive: true });
  const payload = Buffer.alloc(bytes, 'a');
  await fsPromises.writeFile(path.join(repoPath, 'data.bin'), payload);
  const stamp = new Date(mtimeMs);
  await fsPromises.utimes(repoPath, stamp, stamp);
  return repoPath;
};

const run = (args, label) => {
  const result = spawnSync(process.execPath, [toolPath, ...args], { env, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
};

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

const now = Date.now();
await makeRepo('old-repo', 2048, now - 5 * 24 * 60 * 60 * 1000);
const newRepoPath = await makeRepo('new-repo', 2048, now);

const ageOutput = run(['--max-age-days', '1', '--json'], 'cache-gc age');
const agePayload = JSON.parse(ageOutput);
if (!agePayload.removals.some((entry) => entry.id === 'old-repo')) {
  console.error('cache-gc age failed to remove old-repo');
  process.exit(1);
}
if (!fs.existsSync(newRepoPath)) {
  console.error('cache-gc age removed new-repo unexpectedly');
  process.exit(1);
}

await fsPromises.rm(repoRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await makeRepo('repo-a', 4096, now - 10 * 24 * 60 * 60 * 1000);
const repoBPath = await makeRepo('repo-b', 4096, now - 1 * 24 * 60 * 60 * 1000);

const sizeOutput = run(['--max-bytes', '4096', '--json'], 'cache-gc size');
const sizePayload = JSON.parse(sizeOutput);
if (!sizePayload.removals.some((entry) => entry.id === 'repo-a')) {
  console.error('cache-gc size failed to remove oldest repo-a');
  process.exit(1);
}
if (!fs.existsSync(repoBPath)) {
  console.error('cache-gc size removed repo-b unexpectedly');
  process.exit(1);
}

console.log('cache gc test passed');

