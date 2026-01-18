#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanup, root } from './smoke-utils.js';

const tempRoot = path.join(root, 'tests', '.cache', 'smoke-retrieval');
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
  const helpOutput = `${helpResult.stdout || ''}${helpResult.stderr || ''}`;
  const requiredFlags = ['--calls', '--uses', '--author', '--import', '--explain'];
  for (const flag of requiredFlags) {
    if (!helpOutput.includes(flag)) {
      fail(`Help output missing flag: ${flag}`);
    }
  }

  const rrfResult = runNode(
    'search rrf',
    [searchPath, 'return', '--mode', 'code', '--ann', '--json', '--repo', repoRoot]
  );
  let rrfPayload = null;
  try {
    rrfPayload = JSON.parse(rrfResult.stdout || '{}');
  } catch {
    fail('search rrf test failed: invalid JSON output');
  }
  const rrfHit = rrfPayload?.code?.[0];
  if (!rrfPayload?.stats?.annActive) {
    fail('search rrf test failed: annActive was false');
  }
  if (!rrfHit?.scoreBreakdown?.rrf) {
    fail('search rrf test failed: scoreBreakdown.rrf missing');
  }
  if (rrfHit.scoreType !== 'rrf') {
    fail(`search rrf test failed: expected scoreType rrf, got ${rrfHit.scoreType}`);
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
  const explainOutput = stripAnsi(`${explainResult.stdout || ''}${explainResult.stderr || ''}`);
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
