#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';
import { setupToolingInstallWorkspace } from '../../helpers/tooling-install-fixture.js';

const {
  root,
  repoRoot,
  outsideRoot,
  cacheRoot
} = await setupToolingInstallWorkspace('tool-root', {
  root: process.cwd(),
  includeOutsideRoot: true
});
const srcDir = path.join(repoRoot, 'src');

await fsPromises.mkdir(srcDir, { recursive: true });

await fsPromises.writeFile(
  path.join(srcDir, 'index.js'),
  'export function greet(name) {\n  return `hi ${name}`;\n}\n',
  'utf8'
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
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--stage', 'stage2', '--mode', 'code', '--repo', repoRoot],
  { cwd: outsideRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('Failed: build_index from outside repo root');
  process.exit(buildResult.status ?? 1);
}

const searchResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), 'greet', '--json', '--mode', 'code', '--no-ann', '--repo', repoRoot],
  { cwd: outsideRoot, env, encoding: 'utf8' }
);
if (searchResult.status !== 0) {
  console.error('Failed: search from outside repo root');
  console.error(searchResult.stderr || searchResult.stdout || '');
  process.exit(searchResult.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(searchResult.stdout || '{}');
} catch {
  console.error('Failed: search output was not JSON');
  process.exit(1);
}

const hits = payload.code || [];
if (!hits.length) {
  console.error('Failed: search returned no results');
  process.exit(1);
}

console.log('Tool root outside-repo test passed');

