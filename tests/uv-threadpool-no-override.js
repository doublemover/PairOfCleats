#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const cacheRoot = path.join(root, 'tests', '.cache', 'uv-threadpool-no-override');
const repoRoot = path.join(cacheRoot, 'repo');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({ runtime: { uvThreadpoolSize: 64 } }, null, 2)
);

const binPath = path.join(root, 'bin', 'pairofcleats.js');
if (!fs.existsSync(binPath)) {
  console.error(`Missing CLI wrapper: ${binPath}`);
  process.exit(1);
}

const env = { ...process.env, UV_THREADPOOL_SIZE: '5' };

const result = spawnSync(process.execPath, [binPath, 'config', 'dump', '--repo', repoRoot, '--json'], {
  encoding: 'utf8',
  env
});

if (result.status !== 0) {
  console.error('config dump failed');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch {
  console.error('config dump did not output valid JSON');
  process.exit(1);
}

const runtime = payload?.derived?.runtime;
if (!runtime || typeof runtime !== 'object') {
  console.error('config dump payload missing derived.runtime');
  process.exit(1);
}

if (runtime.uvThreadpoolSize !== 64) {
  console.error(`expected runtime.uvThreadpoolSize=64 but got ${runtime.uvThreadpoolSize}`);
  process.exit(1);
}

if (runtime.effectiveUvThreadpoolSize !== 5) {
  console.error(`expected runtime.effectiveUvThreadpoolSize=5 but got ${runtime.effectiveUvThreadpoolSize}`);
  process.exit(1);
}

console.log('uv threadpool no-override test passed');
