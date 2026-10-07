#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const lspTestsDir = path.join(root, 'tests', 'tooling', 'lsp');
const fixtureBinDir = path.join(root, 'tests', 'fixtures', 'lsp', 'bin');
const fileNames = await fs.readdir(lspTestsDir);
const fixtureBins = new Set(await fs.readdir(fixtureBinDir));
const fixtureCommandByProvider = new Map([
  ['pyright', 'pyright-langserver'],
  ['sourcekit', 'sourcekit-lsp']
]);

const coverageByProvider = new Map([
  ['clangd', [/^clangd-/u, /^protocol-/u]],
  ['pyright', [/^pyright-/u]],
  ['sourcekit', [/^sourcekit-/u]],
  ['gopls', [/^configured-provider-go/u, /^configured-provider-gopls/u]],
  ['rust-analyzer', [/^configured-provider-rust/u]],
  ['yaml-language-server', [/^configured-provider-yaml/u]],
  ['lua-language-server', [/^configured-provider-lua/u]],
  ['zls', [/^configured-provider-zls/u]],
  ['jdtls', [/^jdtls-/u]],
  ['csharp-ls', [/^csharp-/u]],
  ['elixir-ls', [/^elixir-/u]],
  ['haskell-language-server', [/^haskell-/u]],
  ['phpactor', [/^phpactor-/u]],
  ['solargraph', [/^solargraph-/u]],
  ['dart', [/^dart-/u]]
]);

for (const [providerId, patterns] of coverageByProvider.entries()) {
  const matched = fileNames.some((fileName) => patterns.some((pattern) => pattern.test(fileName)));
  assert.equal(matched, true, `expected targeted LSP test coverage for ${providerId}`);
  const fixtureCommand = fixtureCommandByProvider.get(providerId) || providerId;
  assert.equal(
    fixtureBins.has(fixtureCommand) || fixtureBins.has(`${fixtureCommand}.cmd`),
    true,
    `expected fixture binary coverage for ${providerId}`
  );
}

console.log('LSP provider fidelity coverage contract test passed');
