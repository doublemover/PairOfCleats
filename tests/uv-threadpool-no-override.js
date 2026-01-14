#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const cacheRoot = path.join(root, 'tests', '.cache', 'uv-threadpool-no-override');
const repoRoot = path.join(cacheRoot, 'repo');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({ runtime: { uvThreadpoolSize: 8 } }, null, 2)
);

const cliPath = path.join(root, 'bin', 'pairofcleats.js');
const env = { ...process.env, UV_THREADPOOL_SIZE: '4' };

const result = spawnSync(
  process.execPath,
  [cliPath, 'config', 'dump', '--json', '--repo', repoRoot],
  { encoding: 'utf8', env }
);

if (result.status !== 0) {
  throw new Error(`uv-threadpool-no-override test failed: ${result.stderr || result.stdout}`);
}

let payload;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch (err) {
  throw new Error(`uv-threadpool-no-override test failed: invalid JSON output: ${err?.message || err}`);
}

const runtime = payload?.derived?.runtime || {};
if (runtime.uvThreadpoolSize !== 8) {
  throw new Error(`uv-threadpool-no-override test failed: expected derived.runtime.uvThreadpoolSize=8, got ${runtime.uvThreadpoolSize}`);
}
if (runtime.effectiveUvThreadpoolSize !== 4) {
  throw new Error(`uv-threadpool-no-override test failed: expected derived.runtime.effectiveUvThreadpoolSize=4, got ${runtime.effectiveUvThreadpoolSize}`);
}

console.log('uv-threadpool-no-override test passed');
