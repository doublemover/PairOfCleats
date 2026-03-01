#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../../helpers/root.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';

const root = repoRoot();
const { dir: tempRoot } = await prepareIsolatedTestCacheDir('index-lifecycle', { root });
const repoDir = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const buildIndexPath = path.join(root, 'build_index.js');
const validatePath = path.join(root, 'tools', 'index', 'validate.js');

try {
  await fsPromises.mkdir(repoDir, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  await fsPromises.writeFile(
    path.join(repoDir, 'alpha.js'),
    'export const alpha = () => "alpha";\n'
  );

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    syncProcess: false,
    testConfig: {
      indexing: {
        scm: { provider: 'none' }
      }
    }
  });

  runNode(
    [buildIndexPath, '--stub-embeddings', '--mode', 'code', '--repo', repoDir],
    'index build for lifecycle contract',
    repoDir,
    env
  );

  const validateResult = runNode(
    [validatePath, '--json', '--mode', 'code', '--repo', repoDir],
    'index validate for lifecycle contract',
    repoDir,
    env,
    { stdio: 'pipe', encoding: 'utf8' }
  );

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
} finally {
  try {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  } catch {}
}

