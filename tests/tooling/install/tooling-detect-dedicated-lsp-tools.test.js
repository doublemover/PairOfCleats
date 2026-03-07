#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const result = spawnSync(process.execPath, [
  path.join(root, 'tools', 'tooling', 'detect.js'),
  '--root', fixtureRoot,
  '--languages', 'java,csharp,ruby,elixir,haskell,php,dart',
  '--json'
], { encoding: 'utf8' });

if (result.status !== 0) {
  console.error('tooling-detect dedicated lsp tools test failed: detect command failed');
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(result.stdout);
} catch {
  console.error('tooling-detect dedicated lsp tools test failed: stdout was not valid JSON');
  process.exit(1);
}

const toolIds = new Set((payload.tools || []).map((tool) => tool.id));
const required = [
  'jdtls',
  'csharp-ls',
  'solargraph',
  'elixir-ls',
  'haskell-language-server',
  'phpactor',
  'dart'
];

for (const toolId of required) {
  if (!toolIds.has(toolId)) {
    console.error(`tooling-detect dedicated lsp tools test failed: missing tool ${toolId}`);
    process.exit(1);
  }
}

console.log('tooling detect dedicated lsp tools test passed');
