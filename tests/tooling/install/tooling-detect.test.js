#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const result = spawnSync(process.execPath, [
  path.join(root, 'tools', 'tooling', 'detect.js'),
  '--root', fixtureRoot,
  '--json'
], { encoding: 'utf8' });

if (result.status !== 0) {
  console.error('tooling-detect failed');
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(result.stdout);
} catch {
  console.error('tooling-detect did not return JSON');
  process.exit(1);
}

const languages = payload.languages || {};
const required = ['python', 'rust', 'go', 'java', 'cpp', 'objc', 'swift'];
for (const lang of required) {
  if (!languages[lang]) {
    console.error(`Missing detected language: ${lang}`);
    process.exit(1);
  }
}

const toolIds = (payload.tools || []).map((tool) => tool.id);
const toolRequired = ['clangd', 'gopls', 'rust-analyzer', 'jdtls', 'sourcekit-lsp'];
for (const tool of toolRequired) {
  if (!toolIds.includes(tool)) {
    console.error(`Missing tooling entry: ${tool}`);
    process.exit(1);
  }
}

console.log('tooling detect test passed');
