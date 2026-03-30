#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cliEntryPath = path.join(root, 'tools', 'search', 'cli-entry.js');
const searchPath = path.join(root, 'search.js');
const searchEntryPath = path.join(root, 'src', 'retrieval', 'cli', 'search-entry.js');
const env = applyTestEnv({ syncProcess: false });

const runCli = (args) => spawnSync(process.execPath, [cliEntryPath, ...args], {
  cwd: root,
  encoding: 'utf8',
  env
});

const runLegacySearch = (args, localEnv = env) => spawnSync(process.execPath, [searchPath, ...args], {
  cwd: root,
  encoding: 'utf8',
  env: localEnv
});

const helpEnv = { ...process.env };
delete helpEnv.PAIROFCLEATS_TESTING;
delete helpEnv.PAIROFCLEATS_SUPPRESS_LEGACY_ENTRYPOINT_WARNING;
delete helpEnv.CI;

const source = await fsPromises.readFile(searchEntryPath, 'utf8');
const helpIndex = source.indexOf('hasHelpArg(args)');
const versionIndex = source.indexOf('hasVersionArg(args)');
const importIndex = source.indexOf("await import('../../integrations/core/index.js')");

assert.notEqual(helpIndex, -1);
assert.notEqual(versionIndex, -1);
assert.notEqual(importIndex, -1);
assert.ok(helpIndex < importIndex && versionIndex < importIndex);
assert.ok(!/from ['"]\.\.\/\.\.\/integrations\/core\/index\.js['"]/.test(source));
assert.ok(/import\(['"]\.\.\/\.\.\/integrations\/core\/index\.js['"]\)/.test(source));

const version = runCli(['--version']);
assert.equal(version.status, 0);
assert.match(version.stdout, /^\d+\.\d+\.\d+(?:[-+][^\r\n]+)?\r?\n?$/);

const bareHelp = runLegacySearch([], helpEnv);
assert.notEqual(bareHelp.status, 0);
const bareHelpOutput = `${bareHelp.stdout || ''}\n${bareHelp.stderr || ''}`;
assert.match(bareHelpOutput, /\[deprecated\] search\.js/);
for (const flag of ['--calls', '--uses', '--author', '--import', '--explain']) {
  assert.match(bareHelpOutput, new RegExp(flag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')));
}

const cliHelp = spawnSync(process.execPath, [cliEntryPath, '--help'], { encoding: 'utf8' });
assert.equal(cliHelp.status, 0);
assert.match(`${cliHelp.stdout || ''}${cliHelp.stderr || ''}`, /Usage: search/);

const invalidMode = runCli(['--mode', 'wat', '--', 'alpha']);
assert.equal(invalidMode.status, 1);
assert.match(stripAnsi(invalidMode.stderr), /Search Error/);
assert.match(stripAnsi(invalidMode.stderr), /code invalid_request/);
assert.match(stripAnsi(invalidMode.stderr), /next choose one of code, prose, both, extracted-prose, records, or all/);
assert.match(stripAnsi(invalidMode.stderr), /Invalid --mode wat/);

const removedFlag = runCli(['--human', '--', 'alpha']);
assert.equal(removedFlag.status, 1);
assert.match(stripAnsi(removedFlag.stderr), /Search Error/);
assert.match(stripAnsi(removedFlag.stderr), /flag --human/);
assert.match(stripAnsi(removedFlag.stderr), /next switch to --json/);

for (const flag of [
  '--type',
  '--author',
  '--import',
  '--repo',
  '--modified-since',
  '--bm25-k1',
  '--path',
  '--lang',
  '--ext',
  '--ann-backend',
  '--graph-ranking-max-work',
  '--fts-weights',
  '--risk'
]) {
  const result = runLegacySearch(['test', flag], env);
  assert.notEqual(result.status, 0, `expected non-zero exit for ${flag}`);
  assert.match(`${result.stdout || ''}${result.stderr || ''}`, new RegExp(`Missing value for ${flag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`));
}

for (const flag of ['--human', '--headline']) {
  const result = runLegacySearch(['test', flag], helpEnv);
  assert.notEqual(result.status, 0, `expected non-zero exit for ${flag}`);
  const output = `${result.stdout || ''}${result.stderr || ''}`.toLowerCase();
  assert.match(output, /removed/);
  assert.match(output, new RegExp(flag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&').toLowerCase()));
}

const tempRoot = resolveTestCachePath(root, 'search-non-result-missing-index');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const missingIndex = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), 'alpha', '--mode', 'code', '--no-ann', '--repo', repoRoot],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      PAIROFCLEATS_CACHE_ROOT: cacheRoot,
      PAIROFCLEATS_EMBEDDINGS: 'stub'
    }
  }
);
assert.notEqual(missingIndex.status, 0);
assert.match(stripAnsi(`${missingIndex.stdout || ''}\n${missingIndex.stderr || ''}`), /build-index/i);

console.log('non-result search surfaces test passed');
