#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../helpers/stdio.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'e2e-smoke');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'alpha.js'),
  'export function alpha() { return 1; }\n'
);
await fsPromises.writeFile(
  path.join(repoRoot, 'README.md'),
  '# Alpha Repo\nThis is a tiny repo for smoke testing.\n'
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const runNode = (label, args, options = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    ...options
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result;
};

runNode('build index', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot], { stdio: 'inherit' });

const search = runNode('search', [
  path.join(root, 'search.js'),
  'alpha',
  '--mode',
  'code',
  '--json',
  '--no-ann',
  '--repo',
  repoRoot
]);
let searchPayload = null;
try {
  searchPayload = JSON.parse(search.stdout || '{}');
} catch {
  console.error('Failed: search output invalid JSON');
  process.exit(1);
}
const codeHits = Array.isArray(searchPayload.code) ? searchPayload.code : [];
if (!codeHits.length) {
  console.error('Failed: search returned no code results');
  process.exit(1);
}

const mapJson = runNode('map json', [
  path.join(root, 'tools', 'reports/report-code-map.js'),
  '--format',
  'json',
  '--repo',
  repoRoot
]);
let mapPayload = null;
try {
  mapPayload = JSON.parse(mapJson.stdout || '{}');
} catch {
  console.error('Failed: map json output invalid');
  process.exit(1);
}
if (!Array.isArray(mapPayload.nodes) || mapPayload.nodes.length === 0) {
  console.error('Failed: map json nodes missing');
  process.exit(1);
}

const mapDot = runNode('map dot', [
  path.join(root, 'tools', 'reports/report-code-map.js'),
  '--format',
  'dot',
  '--repo',
  repoRoot
]);
const mapDotOutput = getCombinedOutput(mapDot);
if (!mapDotOutput.includes('digraph')) {
  console.error('Failed: map dot output missing digraph');
  process.exit(1);
}

const dotCheck = spawnSync('dot', ['-V'], { encoding: 'utf8' });
if (dotCheck.status === 0) {
  const mapSvg = runNode('map svg', [
    path.join(root, 'tools', 'reports/report-code-map.js'),
    '--format',
    'svg',
    '--repo',
    repoRoot
  ]);
  const mapSvgOutput = getCombinedOutput(mapSvg);
  if (!mapSvgOutput.includes('<svg')) {
    console.error('Failed: map svg output missing <svg>');
    process.exit(1);
  }
} else {
  console.log('[skip] Graphviz dot missing; svg map output skipped.');
}

console.log('e2e smoke test passed');

