#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { syncProcessEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = path.join(root, '.testCache', 'retrieval-strict-manifest-embeddings');

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
syncProcessEnv(env);

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const run = (args, label) => {
  const result = spawnSync(process.execPath, args, {
    env,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
};

run([path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', fixtureRoot], 'build index');
run([path.join(root, 'tools', 'build/embeddings.js'), '--stub-embeddings', '--repo', fixtureRoot], 'build embeddings');

const userConfig = loadUserConfig(fixtureRoot);
const codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
const manifestPath = path.join(codeDir, 'pieces', 'manifest.json');
await fsPromises.rm(manifestPath, { force: true });
await fsPromises.rm(`${manifestPath}.bak`, { force: true });

const searchArgs = [
  path.join(root, 'search.js'),
  'token',
  '--backend',
  'memory',
  '--json',
  '--repo',
  fixtureRoot
];
const strictResult = spawnSync(process.execPath, searchArgs, {
  env,
  encoding: 'utf8'
});
if (strictResult.status === 0) {
  console.error('Expected strict search to fail without pieces manifest.');
  process.exit(1);
}
const strictOut = strictResult.stdout || '';
let strictPayload = null;
try {
  strictPayload = JSON.parse(strictOut);
} catch {}
const strictMessage = strictPayload?.message || strictOut || strictResult.stderr || '';
if (!String(strictMessage).toLowerCase().includes('manifest')) {
  console.error('Expected strict search failure to mention manifest.');
  process.exit(1);
}

const nonStrictResult = spawnSync(
  process.execPath,
  [...searchArgs, '--non-strict'],
  { env, encoding: 'utf8' }
);
if (nonStrictResult.status !== 0) {
  console.error('Expected non-strict search to succeed without pieces manifest.');
  if (nonStrictResult.stderr) console.error(nonStrictResult.stderr.trim());
  process.exit(nonStrictResult.status ?? 1);
}
const warnOutput = `${nonStrictResult.stderr || ''}`;
if (!warnOutput.toLowerCase().includes('non-strict') && !warnOutput.toLowerCase().includes('manifest')) {
  console.error('Expected non-strict search to warn about manifest fallback.');
  process.exit(1);
}

console.log('retrieval strict manifest embeddings test passed');
