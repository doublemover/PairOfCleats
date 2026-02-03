#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoId } from '../../../tools/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'query-cache-extracted-prose');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const srcDir = path.join(repoRoot, 'src');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });

const commentText = 'extracted-prose cache sentinel';
const source = [
  '/**',
  ` * ${commentText}`,
  ' */',
  'export function sample() { return 1; }',
  ''
].join('\n');
await fsPromises.writeFile(path.join(srcDir, 'sample.js'), source);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    quality: 'max',
    indexing: {
      scm: { provider: 'none' }
    }
  }
});

const repoId = getRepoId(repoRoot);
const repoCacheBase = path.join(cacheRoot, 'repos', repoId);
const readTail = (filePath, maxLines = 120) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
  } catch {
    return '';
  }
};
const logCrash = () => {
  const logsDir = path.join(repoCacheBase, 'logs');
  const crashLog = path.join(logsDir, 'index-crash.log');
  const crashState = path.join(logsDir, 'index-crash-state.json');
  console.error(`Crash logs: ${logsDir}`);
  if (fs.existsSync(crashState)) {
    const stateText = readTail(crashState);
    if (stateText) {
      console.error('index-crash-state.json:');
      console.error(stateText);
    }
  }
  if (fs.existsSync(crashLog)) {
    const tail = readTail(crashLog);
    if (tail) {
      console.error('index-crash.log (tail):');
      console.error(tail);
    }
  }
};

const run = (args, label, { includeCrashLog = false } = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
    if (includeCrashLog) logCrash();
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
};

run(
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot, '--mode', 'extracted-prose'],
  'build index',
  { includeCrashLog: true }
);

const searchArgs = [
  path.join(root, 'search.js'),
  '--repo',
  repoRoot,
  '--mode',
  'extracted-prose',
  '--no-ann',
  '--json',
  '--stats',
  commentText
];
const first = JSON.parse(run(searchArgs, 'search (first)'));
const second = JSON.parse(run(searchArgs, 'search (second)'));

if (!first?.stats?.cache || first.stats.cache.hit !== false) {
  console.error('Query cache extracted-prose test failed: first request should be cache miss.');
  process.exit(1);
}
if (!second?.stats?.cache || second.stats.cache.hit !== true) {
  console.error('Query cache extracted-prose test failed: second request should be cache hit.');
  process.exit(1);
}
const hits = Array.isArray(second.extractedProse) ? second.extractedProse : [];
if (!hits.some((hit) => hit?.file === 'src/sample.js')) {
  console.error('Query cache extracted-prose test failed: expected extracted-prose hit missing.');
  process.exit(1);
}

const repoCacheDirs = await fsPromises.readdir(path.join(cacheRoot, 'repos'));
if (!repoCacheDirs.length) {
  console.error('Query cache extracted-prose test failed: repo cache not created.');
  process.exit(1);
}
const repoCacheRoot = path.join(cacheRoot, 'repos', repoCacheDirs[0]);
const queryCachePath = path.join(repoCacheRoot, 'query-cache', 'queryCache.json');
if (!fs.existsSync(queryCachePath)) {
  console.error(`Query cache extracted-prose test failed: missing cache file at ${queryCachePath}`);
  process.exit(1);
}
const cacheData = JSON.parse(await fsPromises.readFile(queryCachePath, 'utf8'));
const entries = Array.isArray(cacheData?.entries) ? cacheData.entries : [];
const cached = entries.find((entry) =>
  Array.isArray(entry?.payload?.extractedProse)
  && entry.payload.extractedProse.some((hit) => hit?.file === 'src/sample.js')
);
if (!cached) {
  console.error('Query cache extracted-prose test failed: cached payload missing extracted-prose hits.');
  process.exit(1);
}

console.log('Query cache extracted-prose test passed');

