#!/usr/bin/env node
import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import { getToolingRegistry } from '../../../tools/tooling/utils.js';

const registry = getToolingRegistry('.ci-cache/pairofcleats/tooling', process.cwd());

for (const toolId of ['gopls', 'sqls']) {
  const tool = registry.find((entry) => entry && entry.id === toolId);
  assert.ok(tool, `expected ${toolId} entry in tooling registry`);
  assert.ok(isAbsolute(String(tool.install?.cache?.env?.GOBIN || '')), `${toolId} cache install must use an absolute GOBIN`);
}

for (const toolId of ['omnisharp', 'csharp-ls']) {
  const tool = registry.find((entry) => entry && entry.id === toolId);
  assert.ok(tool, `expected ${toolId} entry in tooling registry`);
  const args = Array.isArray(tool.install?.cache?.args) ? tool.install.cache.args : [];
  const toolPathIndex = args.indexOf('--tool-path');
  assert.notEqual(toolPathIndex, -1, `${toolId} cache install must include --tool-path`);
  assert.ok(isAbsolute(String(args[toolPathIndex + 1] || '')), `${toolId} cache install must use an absolute --tool-path`);
}

for (const toolId of ['ruby-lsp', 'solargraph']) {
  const tool = registry.find((entry) => entry && entry.id === toolId);
  assert.ok(tool, `expected ${toolId} entry in tooling registry`);
  const args = Array.isArray(tool.install?.cache?.args) ? tool.install.cache.args : [];
  const installIndex = args.indexOf('-i');
  const binIndex = args.indexOf('-n');
  assert.notEqual(installIndex, -1, `${toolId} cache install must include -i`);
  assert.notEqual(binIndex, -1, `${toolId} cache install must include -n`);
  assert.ok(isAbsolute(String(args[installIndex + 1] || '')), `${toolId} cache install must use an absolute gem install dir`);
  assert.ok(isAbsolute(String(args[binIndex + 1] || '')), `${toolId} cache install must use an absolute gem bin dir`);
}

const phpactor = registry.find((entry) => entry && entry.id === 'phpactor');
assert.ok(phpactor, 'expected phpactor entry in tooling registry');
const phpactorArgs = Array.isArray(phpactor.install?.cache?.args) ? phpactor.install.cache.args : [];
const toolingRootIndex = phpactorArgs.indexOf('--tooling-root');
assert.notEqual(toolingRootIndex, -1, 'phpactor cache install must include --tooling-root');
assert.ok(isAbsolute(String(phpactorArgs[toolingRootIndex + 1] || '')), 'phpactor cache install must use an absolute tooling root');

console.log('tooling registry cache install paths test passed');
