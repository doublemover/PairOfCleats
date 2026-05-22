#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { runNode } from '../../helpers/run-node.js';

const env = applyTestEnv({ syncProcess: false });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const searchScript = path.join(ROOT, 'search.js');

const repoDir = await makeTempDir('pairofcleats-search-help-');
try {
  const helpResult = runNode(
    [searchScript, '--help', '--repo', repoDir],
    'search startup fastpath help',
    ROOT,
    env,
    { stdio: 'pipe' }
  );
  assert.equal(helpResult.status, 0, 'expected search --help to exit 0');
  assert.ok(
    helpResult.stdout.includes('Usage: search'),
    'expected help output'
  );

  const versionResult = runNode(
    [searchScript, '--version'],
    'search startup fastpath version',
    ROOT,
    env,
    { stdio: 'pipe' }
  );
  assert.equal(versionResult.status, 0, 'expected search --version to exit 0');
  assert.ok(versionResult.stdout.trim().length > 0, 'expected version output');
} finally {
  await rmDirRecursive(repoDir);
}

console.log('search startup fastpath test passed');
