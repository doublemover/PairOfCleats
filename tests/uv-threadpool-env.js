#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const cacheRoot = path.join(root, 'tests', '.cache', 'uv-threadpool-env');
const repoRoot = path.join(cacheRoot, 'repo');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({ runtime: { uvThreadpoolSize: 8 } }, null, 2)
);

const cliPath = path.join(root, 'bin', 'pairofcleats.js');
const env = { ...process.env };
delete env.UV_THREADPOOL_SIZE;

const result = spawnSync(
  process.execPath,
  [cliPath, 'config', 'dump', '--json', '--repo', repoRoot],
  { encoding: 'utf8', env }
);

if (result.status !== 0) {
  throw new Error(`uv-threadpool-env test failed: ${result.stderr || result.stdout}`);
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({ runtime: { uvThreadpoolSize: 12 } }, null, 2)
);

const binPath = path.join(root, 'bin', 'pairofcleats.js');
if (!fs.existsSync(binPath)) {
  console.error(`Missing CLI wrapper: ${binPath}`);
  process.exit(1);
}

const env = { ...process.env };
delete env.UV_THREADPOOL_SIZE;

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
} catch (err) {
  throw new Error(`uv-threadpool-env test failed: invalid JSON output: ${err?.message || err}`);
}

const runtime = payload?.derived?.runtime || {};
if (runtime.uvThreadpoolSize !== 8) {
  throw new Error(`uv-threadpool-env test failed: expected derived.runtime.uvThreadpoolSize=8, got ${runtime.uvThreadpoolSize}`);
}
if (runtime.effectiveUvThreadpoolSize !== 8) {
  throw new Error(`uv-threadpool-env test failed: expected derived.runtime.effectiveUvThreadpoolSize=8, got ${runtime.effectiveUvThreadpoolSize}`);
}

console.log('uv-threadpool-env test passed');
} catch {
  console.error('config dump did not output valid JSON');
  process.exit(1);
}

const runtime = payload?.derived?.runtime;
if (!runtime || typeof runtime !== 'object') {
  console.error('config dump payload missing derived.runtime');
  process.exit(1);
}

if (runtime.uvThreadpoolSize !== 12) {
  console.error(`expected runtime.uvThreadpoolSize=12 but got ${runtime.uvThreadpoolSize}`);
  process.exit(1);
}

if (runtime.effectiveUvThreadpoolSize !== 12) {
  console.error(`expected runtime.effectiveUvThreadpoolSize=12 but got ${runtime.effectiveUvThreadpoolSize}`);
  process.exit(1);
}

console.log('uv threadpool env test passed');
