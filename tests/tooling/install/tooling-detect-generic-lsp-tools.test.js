#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const result = spawnSync(process.execPath, [
  path.join(root, 'tools', 'tooling', 'detect.js'),
  '--root', fixtureRoot,
  '--languages', 'go,rust,yaml,lua,zig',
  '--json'
], { encoding: 'utf8' });

if (result.status !== 0) {
  console.error('tooling-detect generic lsp tools test failed: detect command failed');
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(result.stdout);
} catch {
  console.error('tooling-detect generic lsp tools test failed: stdout was not valid JSON');
  process.exit(1);
}

const toolIds = new Set((payload.tools || []).map((tool) => tool.id));
const required = [
  'gopls',
  'rust-analyzer',
  'yaml-language-server',
  'lua-language-server',
  'zls'
];

for (const toolId of required) {
  if (!toolIds.has(toolId)) {
    console.error(`tooling-detect generic lsp tools test failed: missing tool ${toolId}`);
    process.exit(1);
  }
}

console.log('tooling detect generic lsp tools test passed');
