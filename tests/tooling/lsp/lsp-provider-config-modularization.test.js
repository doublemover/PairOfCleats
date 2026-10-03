#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const barrelPath = path.join(root, 'src', 'index', 'tooling', 'lsp-provider.js');
const indexPath = path.join(root, 'src', 'index', 'tooling', 'lsp-provider', 'index.js');
const normalizePath = path.join(root, 'src', 'index', 'tooling', 'lsp-provider', 'normalize.js');
const preflightLanguagePath = path.join(root, 'src', 'index', 'tooling', 'lsp-provider', 'preflight-language.js');
const workspacePath = path.join(root, 'src', 'index', 'tooling', 'lsp-provider', 'workspace.js');
const runtimePath = path.join(root, 'src', 'index', 'tooling', 'lsp-provider', 'runtime.js');
const factoryPath = path.join(root, 'src', 'index', 'tooling', 'lsp-provider', 'factory.js');

for (const target of [barrelPath, indexPath, normalizePath, preflightLanguagePath, workspacePath, runtimePath, factoryPath]) {
  assert.equal(fs.existsSync(target), true, `missing expected LSP provider config module: ${target}`);
}

const barrelSource = fs.readFileSync(barrelPath, 'utf8');
const indexSource = fs.readFileSync(indexPath, 'utf8');
const factorySource = fs.readFileSync(factoryPath, 'utf8');

assert.equal(
  barrelSource.includes("./lsp-provider/index.js"),
  true,
  'expected top-level lsp-provider barrel to delegate to the modularized index'
);

for (const marker of [
  "./factory.js",
  "./normalize.js",
  "./workspace.js"
]) {
  assert.equal(indexSource.includes(marker), true, `expected lsp-provider index to compose ${marker}`);
}

for (const marker of [
  "./normalize.js",
  "./preflight-language.js",
  "./runtime.js",
  "./workspace.js",
  'await awaitToolingProviderPreflight(',
  'resolveRuntimeCommandFromPreflight('
]) {
  assert.equal(factorySource.includes(marker), true, `expected lsp-provider factory to use ${marker}`);
}

for (const legacyInlineMarker of [
  'const normalizeServerConfig = (server, index) => {',
  'const resolveLuaWorkspaceLibraryPreflight = ({ server, repoRoot }) => {',
  'const createConfiguredLspProvider = (server) => {'
]) {
  assert.equal(
    barrelSource.includes(legacyInlineMarker),
    false,
    `expected top-level lsp-provider barrel to stop inlining ${legacyInlineMarker}`
  );
}

console.log('LSP provider config modularization test passed');
