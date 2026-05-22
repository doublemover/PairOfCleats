#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';
import { SEARCH_VALUE_FLAGS } from '../../../src/retrieval/cli-args.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cliEntryPath = path.join(root, 'tools', 'search', 'cli-entry.js');
const searchPath = path.join(root, 'search.js');
const searchEntryPath = path.join(root, 'src', 'retrieval', 'cli', 'search-entry.js');
const env = applyTestEnv({ syncProcess: false });

const runCli = (args, options = {}) => runNode(
  [cliEntryPath, ...args],
  'search CLI entry',
  root,
  env,
  { stdio: 'pipe', allowFailure: options.allowFailure === true }
);

const runLegacySearch = (args, localEnv = env, options = {}) => runNode(
  [searchPath, ...args],
  'legacy search entry',
  root,
  localEnv,
  { stdio: 'pipe', allowFailure: options.allowFailure === true }
);

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

const bareHelp = runLegacySearch([], helpEnv, { allowFailure: true });
assert.notEqual(bareHelp.status, 0);
const bareHelpOutput = `${bareHelp.stdout || ''}\n${bareHelp.stderr || ''}`;
assert.match(bareHelpOutput, /\[deprecated\] search\.js/);
for (const flag of ['--calls', '--uses', '--author', '--import', '--explain']) {
  assert.match(bareHelpOutput, new RegExp(flag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')));
}

const cliHelp = runNode([cliEntryPath, '--help'], 'search CLI help', root, helpEnv, { stdio: 'pipe' });
assert.equal(cliHelp.status, 0);
assert.match(`${cliHelp.stdout || ''}${cliHelp.stderr || ''}`, /Usage: search/);

const invalidMode = runCli(['--mode', 'wat', '--', 'alpha'], { allowFailure: true });
assert.equal(invalidMode.status, 1);
assert.match(stripAnsi(invalidMode.stderr), /Search Error/);
assert.match(stripAnsi(invalidMode.stderr), /code invalid_request/);
assert.match(stripAnsi(invalidMode.stderr), /next choose one of code, prose, both, extracted-prose, records, or all/);
assert.match(stripAnsi(invalidMode.stderr), /Invalid --mode wat/);

const removedFlag = runCli(['--human', '--', 'alpha'], { allowFailure: true });
assert.equal(removedFlag.status, 1);
assert.match(stripAnsi(removedFlag.stderr), /Search Error/);
assert.match(stripAnsi(removedFlag.stderr), /flag --human/);
assert.match(stripAnsi(removedFlag.stderr), /next switch to --json/);

for (const flag of [...SEARCH_VALUE_FLAGS].sort()) {
  const result = runLegacySearch(['test', flag], env, { allowFailure: true });
  assert.notEqual(result.status, 0, `expected non-zero exit for ${flag}`);
  assert.match(`${result.stdout || ''}${result.stderr || ''}`, new RegExp(`Missing value for ${flag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`));
}

for (const flag of ['--human', '--headline']) {
  const result = runLegacySearch(['test', flag], helpEnv, { allowFailure: true });
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

const missingIndexEnv = applyTestEnv({ cacheRoot, embeddings: 'stub', syncProcess: false });
const missingIndex = runNode(
  [path.join(root, 'search.js'), 'alpha', '--mode', 'code', '--no-ann', '--repo', repoRoot],
  'legacy search missing index',
  root,
  missingIndexEnv,
  { stdio: 'pipe', allowFailure: true }
);
assert.notEqual(missingIndex.status, 0);
assert.match(stripAnsi(`${missingIndex.stdout || ''}\n${missingIndex.stderr || ''}`), /build-index/i);

console.log('non-result search surfaces test passed');
