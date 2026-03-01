#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildHoverCacheKey,
  buildSignatureParseCacheKey,
  buildSymbolPositionCacheKey,
  loadHoverCache,
  persistHoverCache
} from '../../../src/integrations/tooling/providers/lsp/hover-types.js';

const baseInput = {
  cmd: 'clangd',
  docHash: 'doc-hash-v2',
  languageId: 'cpp',
  position: { line: 7, character: 3 }
};

const alphaFunctionKey = buildHoverCacheKey({
  ...baseInput,
  symbolName: 'alpha',
  symbolKind: 12
});
const alphaVariableKey = buildHoverCacheKey({
  ...baseInput,
  symbolName: 'alpha',
  symbolKind: 13
});
const betaFunctionKey = buildHoverCacheKey({
  ...baseInput,
  symbolName: 'beta',
  symbolKind: 12
});

assert.equal(alphaFunctionKey?.startsWith('v2|'), true, 'expected hover cache key version v2 prefix');
assert.notEqual(alphaFunctionKey, alphaVariableKey, 'expected hover cache key to vary by symbol kind');
assert.notEqual(alphaFunctionKey, betaFunctionKey, 'expected hover cache key to vary by symbol name');

const alphaPositionKey = buildSymbolPositionCacheKey({
  position: baseInput.position,
  symbolName: 'alpha',
  symbolKind: 12
});
const betaPositionKey = buildSymbolPositionCacheKey({
  position: baseInput.position,
  symbolName: 'beta',
  symbolKind: 12
});
assert.notEqual(alphaPositionKey, betaPositionKey, 'expected symbol-position key to be symbol-sensitive');

const signatureKeyAlpha = buildSignatureParseCacheKey({
  languageId: 'python',
  parserKey: 'pyright',
  detailText: '(value: str) -> str',
  symbolName: 'alpha',
  symbolSensitive: true
});
const signatureKeyBeta = buildSignatureParseCacheKey({
  languageId: 'python',
  parserKey: 'pyright',
  detailText: '(value: str) -> str',
  symbolName: 'beta',
  symbolSensitive: true
});
const signatureKeyInsensitiveAlpha = buildSignatureParseCacheKey({
  languageId: 'python',
  parserKey: 'pyright',
  detailText: '(value: str) -> str',
  symbolName: 'alpha',
  symbolSensitive: false
});
const signatureKeyInsensitiveBeta = buildSignatureParseCacheKey({
  languageId: 'python',
  parserKey: 'pyright',
  detailText: '(value: str) -> str',
  symbolName: 'beta',
  symbolSensitive: false
});
assert.notEqual(signatureKeyAlpha, signatureKeyBeta, 'expected signature parse cache key to vary by symbol when symbol-sensitive');
assert.equal(
  signatureKeyInsensitiveAlpha,
  signatureKeyInsensitiveBeta,
  'expected signature parse cache key to ignore symbol when parser is symbol-insensitive'
);

const root = process.cwd();
const tempRoot = path.join(root, '.testLogs', 'lsp-hover-cache-key-v2');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const state = await loadHoverCache(tempRoot);
assert.equal(
  state.path.endsWith(path.join('lsp', 'hover-cache-v2.json')),
  true,
  'expected v2 hover cache filename'
);
state.entries.set(alphaFunctionKey, {
  info: {
    signature: 'int alpha()',
    returnType: 'int'
  },
  at: 1234
});
await persistHoverCache({
  cachePath: state.path,
  entries: state.entries,
  maxEntries: 1000
});
const persisted = JSON.parse(await fs.readFile(state.path, 'utf8'));
assert.equal(persisted?.version, 2, 'expected persisted hover cache schema version 2');

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('LSP hover cache key v2 test passed');
