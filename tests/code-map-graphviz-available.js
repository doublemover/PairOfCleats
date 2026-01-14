#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

const dotCheck = spawnSync('dot', ['-V'], { encoding: 'utf8' });
if (dotCheck.status !== 0) {
  console.log('code map graphviz available test skipped (dot not found)');
  process.exit(0);
}

const tempRoot = path.join(root, 'tests', '.cache', 'code-map-graphviz-available');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({ indexing: { astDataflow: true, controlFlow: true } }, null, 2)
);

await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'a.js'),
  'import { add } from "./b.js";\n' +
    'export function run(x) { return add(x, 1); }\n'
);
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'b.js'),
  'export function add(a, b) { return a + b; }\n'
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (buildResult.status !== 0) {
  console.error('Failed: build index for code map graphviz available test');
  process.exit(buildResult.status ?? 1);
}

// Verify stdout rendering.
const mapStdoutResult = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'report-code-map.js'), '--format', 'svg', '--repo', repoRoot],
  { cwd: repoRoot, env, encoding: 'utf8' }
);

if (mapStdoutResult.status !== 0) {
  console.error('Failed: map svg output (stdout)');
  if (mapStdoutResult.stderr) console.error(mapStdoutResult.stderr.trim());
  process.exit(mapStdoutResult.status ?? 1);
}

const stdoutSvg = (mapStdoutResult.stdout || '').trim();
if (!stdoutSvg.includes('<svg')) {
  console.error('Failed: svg output missing <svg>');
  process.exit(1);
}

// Verify file output through --out + --json.
const outPath = path.join(tempRoot, 'map.svg');
const mapFileResult = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'report-code-map.js'),
    '--format',
    'svg',
    '--out',
    outPath,
    '--json',
    '--repo',
    repoRoot
  ],
  { cwd: repoRoot, env, encoding: 'utf8' }
);

if (mapFileResult.status !== 0) {
  console.error('Failed: map svg output (file)');
  if (mapFileResult.stderr) console.error(mapFileResult.stderr.trim());
  process.exit(mapFileResult.status ?? 1);
}

let report = null;
try {
  report = JSON.parse(mapFileResult.stdout || '{}');
} catch {
  console.error('Failed: svg --json output invalid JSON');
  process.exit(1);
}

if (report.format !== 'svg') {
  console.error(`Failed: expected format svg but saw ${report.format}`);
  process.exit(1);
}
if (!report.outPath) {
  console.error('Failed: svg report missing outPath');
  process.exit(1);
}

const fileSvg = (await fsPromises.readFile(report.outPath, 'utf8')).trim();
if (!fileSvg.includes('<svg')) {
  console.error('Failed: svg file missing <svg>');
  process.exit(1);
}

console.log('code map graphviz available tests passed');
