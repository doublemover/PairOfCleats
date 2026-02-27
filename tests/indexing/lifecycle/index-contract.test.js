#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../helpers/root.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = repoRoot();
const tempRoot = resolveTestCachePath(root, 'index-lifecycle');
const repoDir = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoDir, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoDir, 'alpha.js'),
  'export const alpha = () => "alpha";\n'
);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoDir],
  { cwd: repoDir, env, stdio: 'inherit' }
);

if (buildResult.status !== 0) {
  console.error('Failed: index build for lifecycle contract');
  process.exit(buildResult.status ?? 1);
}

const validateResult = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'index', 'validate.js'), '--json', '--mode', 'code', '--repo', repoDir],
  { cwd: repoDir, env, encoding: 'utf8' }
);

if (validateResult.status !== 0) {
  console.error('Failed: index validate for lifecycle contract');
  if (validateResult.stderr) console.error(validateResult.stderr.trim());
  process.exit(validateResult.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(validateResult.stdout || '{}');
} catch {
  console.error('Failed: index validate returned invalid JSON');
  process.exit(1);
}

if (!payload || typeof payload !== 'object') {
  console.error('Failed: index validate payload missing');
  process.exit(1);
}

if (!payload.ok) {
  console.error('Failed: index validate reported issues');
  if (Array.isArray(payload.issues)) {
    payload.issues.forEach((issue) => console.error(`- ${issue}`));
  }
  process.exit(1);
}

if (!payload.modes || !payload.modes.code) {
  console.error('Failed: index validate missing code mode');
  process.exit(1);
}

console.log('index lifecycle contract tests passed');

