#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

process.env.PAIROFCLEATS_TESTING = '1';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const searchScript = path.join(ROOT, 'search.js');

const repoDir = await makeTempDir('pairofcleats-search-help-');
try {
  const helpResult = spawnSync(
    process.execPath,
    [searchScript, '--help', '--repo', repoDir],
    { encoding: 'utf8' }
  );
  assert.equal(helpResult.status, 0, 'expected search --help to exit 0');
  assert.ok(
    helpResult.stdout.includes('Usage: search'),
    'expected help output'
  );

  const versionResult = spawnSync(
    process.execPath,
    [searchScript, '--version'],
    { encoding: 'utf8' }
  );
  assert.equal(versionResult.status, 0, 'expected search --version to exit 0');
  assert.ok(versionResult.stdout.trim().length > 0, 'expected version output');
} finally {
  await rmDirRecursive(repoDir);
}

console.log('search startup fastpath test passed');
