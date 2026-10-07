#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getCombinedOutput } from '../../helpers/stdio.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'cli');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
const env = applyTestEnv({ cacheRoot, syncProcess: false });

const binPath = path.join(root, 'bin', 'pairofcleats.js');
if (!fs.existsSync(binPath)) {
  console.error(`Missing CLI entrypoint: ${binPath}`);
  process.exit(1);
}
const { extractDispatchRootArg } = await import(pathToFileURL(binPath).href);

const runCli = (args, options = {}) => runNode(
  [binPath, ...args],
  `pairofcleats ${args.join(' ')}`,
  root,
  env,
  {
    stdio: 'pipe',
    allowFailure: options.allowFailure === true
  }
);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version || '0.0.0';

const versionResult = runCli(['--version']);
if (versionResult.status !== 0) {
  console.error('cli --version failed');
  process.exit(versionResult.status ?? 1);
}
const versionOutput = getCombinedOutput(versionResult, { trim: true });
if (!versionOutput.includes(version)) {
  console.error('cli --version did not output expected version');
  process.exit(1);
}

const helpResult = runCli(['--help']);
if (helpResult.status !== 0) {
  console.error('cli --help failed');
  process.exit(helpResult.status ?? 1);
}
const helpOutput = getCombinedOutput(helpResult);
if (!helpOutput.includes('Usage: pairofcleats')) {
  console.error('cli --help missing usage banner');
  process.exit(1);
}
if (!helpOutput.includes('Common workflows:')) {
  console.error('cli --help missing common workflows section');
  process.exit(1);
}
if (!helpOutput.includes('Operator commands:')) {
  console.error('cli --help missing operator section');
  process.exit(1);
}
if (!helpOutput.includes('CLI:')) {
  console.error('cli --help missing CLI section');
  process.exit(1);
}
if (!helpOutput.includes('cli completions')) {
  console.error('cli --help missing cli completions entry');
  process.exit(1);
}
if (!helpOutput.includes('risk delta')) {
  console.error('cli --help missing stable registry-derived risk delta entry');
  process.exit(1);
}
if (helpOutput.includes('dispatch list')) {
  console.error('cli --help should hide internal dispatch commands by default');
  process.exit(1);
}

const helpAliasAllResult = runCli(['--help', '--all']);
if (helpAliasAllResult.status !== 0) {
  console.error('cli --help --all failed');
  process.exit(helpAliasAllResult.status ?? 1);
}
const helpAliasAllOutput = getCombinedOutput(helpAliasAllResult);
if (!helpAliasAllOutput.includes('dispatch list')) {
  console.error('cli --help --all missing internal dispatch list entry');
  process.exit(1);
}
if (!helpAliasAllOutput.includes('bench matrix')) {
  console.error('cli --help --all missing experimental bench matrix entry');
  process.exit(1);
}

const reportHelpResult = runCli(['help', 'report']);
if (reportHelpResult.status !== 0) {
  console.error('cli help report failed');
  process.exit(reportHelpResult.status ?? 1);
}
const reportHelpOutput = getCombinedOutput(reportHelpResult);
if (!reportHelpOutput.includes('Help topic: report')) {
  console.error('cli help report missing topic header');
  process.exit(1);
}
if (!reportHelpOutput.includes('throughput')) {
  console.error('cli help report missing report throughput subcommand');
  process.exit(1);
}

const helpHelpResult = runCli(['help', '--help']);
if (helpHelpResult.status !== 0) {
  console.error('cli help --help failed');
  process.exit(helpHelpResult.status ?? 1);
}
const helpHelpOutput = getCombinedOutput(helpHelpResult);
if (!helpHelpOutput.includes('Usage: pairofcleats')) {
  console.error('cli help --help should render top-level help');
  process.exit(1);
}

const malformedHelpResult = runCli(['help', 'report', 'typo'], { allowFailure: true });
if (malformedHelpResult.status === 0) {
  console.error('cli help report typo should fail');
  process.exit(1);
}
const malformedHelpOutput = getCombinedOutput(malformedHelpResult);
if (!malformedHelpOutput.includes('Unknown help topic: report typo')) {
  console.error('cli help report typo missing unknown-topic error');
  process.exit(1);
}

const mcpAliasHelpResult = runCli(['service', 'mcp', '--mcpMode', 'sdk', '--help']);
if (mcpAliasHelpResult.status !== 0) {
  console.error('cli service mcp --mcpMode --help failed');
  process.exit(mcpAliasHelpResult.status ?? 1);
}
const mcpAliasOutput = getCombinedOutput(mcpAliasHelpResult);
if (mcpAliasOutput.includes('Unknown flag: --mcpMode')) {
  console.error('cli service mcp rejected --mcpMode alias');
  process.exit(1);
}
if (!mcpAliasOutput.includes('--mcp-mode, --mcpMode')) {
  console.error('cli service mcp --help should render mcp mode options through the lightweight entry');
  process.exit(1);
}

const mcpVersionResult = runCli(['service', 'mcp', '--version']);
if (mcpVersionResult.status !== 0) {
  console.error('cli service mcp --version failed');
  process.exit(mcpVersionResult.status ?? 1);
}
const mcpVersionOutput = getCombinedOutput(mcpVersionResult, { trim: true });
if (!mcpVersionOutput.includes(version)) {
  console.error('cli service mcp --version should stay lightweight and machine-parseable');
  process.exit(1);
}

const permissiveSearchHelp = runCli(['search', '--definitely-not-a-search-flag', '--help']);
if (permissiveSearchHelp.status !== 0) {
  console.error('cli search should stay permissive by default');
  process.exit(permissiveSearchHelp.status ?? 1);
}

const strictSearchHelp = runCli(['search', '--strict-dispatch', '--backend', 'tantivy', '-n', '10', '--help']);
if (strictSearchHelp.status !== 0) {
  console.error('cli search strict dispatch should accept registered search flags and -n alias');
  process.exit(strictSearchHelp.status ?? 1);
}

const strictSearchUnknown = runCli(['search', '--strict-dispatch', '--definitely-not-a-search-flag', '--help'], {
  allowFailure: true
});
if (strictSearchUnknown.status === 0) {
  console.error('cli search strict dispatch should reject unknown flags');
  process.exit(1);
}
const strictSearchUnknownOutput = getCombinedOutput(strictSearchUnknown);
if (!strictSearchUnknownOutput.includes('Unknown flag: --definitely-not-a-search-flag')) {
  console.error('cli search strict dispatch missing unknown-flag error');
  process.exit(1);
}

const envStrictSearchUnknown = runNode(
  [binPath, 'search', '--definitely-not-a-search-flag', '--help'],
  'pairofcleats search strict env unknown flag',
  root,
  { ...env, PAIROFCLEATS_DISPATCH_STRICT: '1' },
  { stdio: 'pipe', allowFailure: true }
);
if (envStrictSearchUnknown.status === 0) {
  console.error('cli search env strict dispatch should reject unknown flags');
  process.exit(1);
}

const dispatchDescribeSearch = runCli(['dispatch', 'describe', 'search', '--json']);
if (dispatchDescribeSearch.status !== 0) {
  console.error('dispatch describe search failed');
  process.exit(dispatchDescribeSearch.status ?? 1);
}
const dispatchDescribePayload = JSON.parse(dispatchDescribeSearch.stdout || '{}');
assert.equal(dispatchDescribePayload.metadata?.strictDispatch?.env, 'PAIROFCLEATS_DISPATCH_STRICT');
assert.equal(dispatchDescribePayload.metadata?.strictDispatch?.flag, '--strict-dispatch');
assert.ok(dispatchDescribePayload.metadata?.optionMetadata?.valueFlags?.includes('backend'));
assert.ok(dispatchDescribePayload.metadata?.optionMetadata?.shortValueFlags?.includes('n'));

const invalidConfigRepo = path.join(cacheRoot, 'invalid-config-repo');
await fsPromises.mkdir(invalidConfigRepo, { recursive: true });
await fsPromises.writeFile(path.join(invalidConfigRepo, '.pairofcleats.json'), '{ invalid json');
const mcpHelpInvalidConfigResult = runCli(['service', 'mcp', '--repo', invalidConfigRepo, '--help']);
if (mcpHelpInvalidConfigResult.status !== 0) {
  console.error('cli service mcp --help should not load invalid repo config');
  process.exit(mcpHelpInvalidConfigResult.status ?? 1);
}
const mcpHelpInvalidConfigOutput = getCombinedOutput(mcpHelpInvalidConfigResult);
if (!mcpHelpInvalidConfigOutput.includes('--mcp-mode, --mcpMode')) {
  console.error('cli service mcp --help should still print lightweight help under invalid repo config');
  process.exit(1);
}

const contextPackFederatedHelp = runCli([
  'context-pack',
  '--help',
  '--strictEvidence',
  '--workspace', fixtureRoot,
  '--workspaceId', 'ws-demo',
  '--select', 'repo-a',
  '--repo-filter', 'repo',
  '--includeDisabled',
  '--maxFederatedRepos', '2'
]);
if (contextPackFederatedHelp.status !== 0) {
  console.error('cli context-pack federated help failed');
  process.exit(contextPackFederatedHelp.status ?? 1);
}
const contextPackFederatedOutput = getCombinedOutput(contextPackFederatedHelp);
if (contextPackFederatedOutput.includes('Unknown flag: --strictEvidence')) {
  console.error('cli context-pack rejected --strictEvidence');
  process.exit(1);
}
if (contextPackFederatedOutput.includes('Unknown flag: --workspace')) {
  console.error('cli context-pack rejected --workspace');
  process.exit(1);
}
if (contextPackFederatedOutput.includes('Unknown flag: --workspaceId')) {
  console.error('cli context-pack rejected --workspaceId');
  process.exit(1);
}
if (contextPackFederatedOutput.includes('Unknown flag: --repo-filter')) {
  console.error('cli context-pack rejected --repo-filter');
  process.exit(1);
}
if (contextPackFederatedOutput.includes('Unknown flag: --includeDisabled')) {
  console.error('cli context-pack rejected --includeDisabled');
  process.exit(1);
}
if (contextPackFederatedOutput.includes('Unknown flag: --maxFederatedRepos')) {
  console.error('cli context-pack rejected --maxFederatedRepos');
  process.exit(1);
}

const toolingDetectRootHelp = runCli(['tooling', 'detect', '--root', fixtureRoot, '--help']);
if (toolingDetectRootHelp.status !== 0) {
  console.error('cli tooling detect --root --help failed');
  process.exit(toolingDetectRootHelp.status ?? 1);
}
const toolingDetectRootOutput = getCombinedOutput(toolingDetectRootHelp);
if (toolingDetectRootOutput.includes('Unknown flag: --root')) {
  console.error('cli tooling detect rejected --root');
  process.exit(1);
}

const toolingInstallRootHelp = runCli(['tooling', 'install', '--root', fixtureRoot, '--tools', 'clangd', '--help']);
if (toolingInstallRootHelp.status !== 0) {
  console.error('cli tooling install --root --help failed');
  process.exit(toolingInstallRootHelp.status ?? 1);
}
const toolingInstallRootOutput = getCombinedOutput(toolingInstallRootHelp);
if (toolingInstallRootOutput.includes('Unknown flag: --root')) {
  console.error('cli tooling install rejected --root');
  process.exit(1);
}

assert.equal(
  extractDispatchRootArg(['--repo', path.join(root, 'repo-a')]),
  path.join(root, 'repo-a'),
  'expected repo override extraction to remain supported'
);
assert.equal(
  extractDispatchRootArg(['--repo', path.join(root, 'repo-a'), '--root', path.join(root, 'repo-b')]),
  path.join(root, 'repo-b'),
  'expected explicit --root to win over --repo for runtime-env resolution'
);

console.log('cli test passed');

