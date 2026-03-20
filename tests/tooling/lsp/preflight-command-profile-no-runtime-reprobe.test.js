#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const FILES = [
  'src/index/tooling/lsp-provider/factory.js',
  'src/index/tooling/dedicated-lsp-provider.js',
  'src/index/tooling/pyright-provider.js',
  'src/index/tooling/clangd-provider.js',
  'src/index/tooling/sourcekit-provider.js'
];

const bannedSnippets = [
  'preflight?.commandProfile && typeof preflight.commandProfile === \'object\'\n      ? preflight.commandProfile\n      : resolveToolingCommandProfile(',
  'if (!commandProfile) {\n        commandProfile = resolveToolingCommandProfile('
];

for (const relativePath of FILES) {
  const abs = path.join(root, relativePath);
  const content = fs.readFileSync(abs, 'utf8');
  for (const snippet of bannedSnippets) {
    assert.equal(
      content.includes(snippet),
      false,
      `expected no runtime command reprobe fallback snippet in ${relativePath}`
    );
  }
}

console.log('preflight command-profile runtime reprobe guard test passed');
