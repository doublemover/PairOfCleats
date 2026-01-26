#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from './helpers/stdio.js';
import { cleanup, root } from './smoke-utils.js';

const tempRoot = path.join(root, '.testCache', 'smoke-retrieval');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const searchPath = path.join(root, 'search.js');

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const fail = (message, exitCode = 1) => {
  const error = new Error(message);
  error.exitCode = exitCode;
  throw error;
};

const runNode = (label, args, options = {}) => {
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', ...options });
  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.trim() : '';
    if (stderr) console.error(stderr);
    fail(`Failed: ${label}`, result.status ?? 1);
  }
  return result;
};

let failure = null;
try {
  await cleanup([tempRoot]);
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

  const build = spawnSync(
    process.execPath,
    [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
    { env, stdio: 'inherit' }
  );
  if (build.status !== 0) {
    fail('smoke retrieval failed: build_index failed', build.status ?? 1);
  }

  const helpResult = spawnSync(process.execPath, [searchPath], { encoding: 'utf8' });
  if (helpResult.status === 0) {
    fail('Expected search help to exit non-zero with no query.');
  }
  const helpOutput = getCombinedOutput(helpResult);
  const requiredFlags = ['--filter', '--explain', '--json', '--mode'];
  for (const flag of requiredFlags) {
    if (!helpOutput.includes(flag)) {
      fail(`Help output missing flag: ${flag}`);
    }
  }

  const annResult = runNode(
    'search ann',
    [searchPath, 'return', '--mode', 'code', '--ann', '--json', '--repo', repoRoot]
  );
  let annPayload = null;
  try {
    annPayload = JSON.parse(annResult.stdout || '{}');
  } catch {
    fail('search ann test failed: invalid JSON output');
  }
  if (!annPayload?.stats?.annActive) {
    fail('search ann test failed: annActive was false');
  }
  const annHit = annPayload?.code?.find((hit) => hit?.scoreBreakdown?.ann);
  if (!annHit) {
    fail('search ann test failed: no ann hits found');
  }
  const annSource = annHit?.scoreBreakdown?.ann?.source;
  if (!annSource) {
    fail('search ann test failed: ann source missing');
  }

  const filterResult = runNode(
    'search filters',
    [
      searchPath,
      'return',
      '--mode',
      'code',
      '--json',
      '--no-ann',
      '--repo',
      repoRoot,
      '--file',
      'src/index.js'
    ]
  );
  const filterPayload = JSON.parse(filterResult.stdout || '{}');
  const filterHits = filterPayload?.code || [];
  if (!filterHits.length) {
    fail('search filter test failed: no results returned');
  }
  const badFilterHit = filterHits.find((hit) => !(hit.file || '').replace(/\\/g, '/').endsWith('src/index.js'));
  if (badFilterHit) {
    fail('search filter test failed: file filter mismatch');
  }

  const stripAnsi = (value) => value.replace(/\u001b\[[0-9;]*m/g, '');
  const explainResult = runNode(
    'search explain',
    [searchPath, 'return', '--mode', 'code', '--no-ann', '--repo', repoRoot, '--explain']
  );
  const explainOutput = stripAnsi(getCombinedOutput(explainResult));
  if (!explainOutput.includes('Score:')) {
    fail('Explain output missing Score breakdown.');
  }
  if (!explainOutput.includes('Sparse:')) {
    fail('Explain output missing Sparse breakdown.');
  }

} catch (err) {
  console.error(err?.message || err);
  failure = err;
}

await cleanup([tempRoot]);
if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke retrieval passed');

