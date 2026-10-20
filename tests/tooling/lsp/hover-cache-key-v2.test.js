#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildLspRequestCacheKey,
  buildSignatureParseCacheKey,
  buildSymbolPositionCacheKey,
  loadLspRequestCache,
  persistLspRequestCache
} from '../../../src/integrations/tooling/providers/lsp/hover-types.js';

const baseInput = {
  providerId: 'clangd',
  providerVersion: '1.2.3',
  workspaceKey: 'repo-root',
  generation: 'immutable-build',
  virtualPath: 'package-a/source.py',
  uri: 'file:///repo/package-a/source.py',
  containerPath: 'package-a/source.py',
  languageId: 'python',
  positionEncoding: 'utf-16',
  docHash: 'doc-hash-v2',
  requestKind: 'hover',
  position: { line: 7, character: 3 }
};

const alphaFunctionKey = buildLspRequestCacheKey(baseInput);
const alphaVariableKey = buildLspRequestCacheKey(baseInput);
const betaFunctionKey = buildLspRequestCacheKey({
  ...baseInput,
  requestKind: 'signature_help'
});

assert.equal(alphaFunctionKey?.startsWith('rq2|'), true, 'expected request cache key policy prefix');
assert.equal(alphaFunctionKey, alphaVariableKey, 'expected request cache key to stay deterministic');
assert.notEqual(alphaFunctionKey, betaFunctionKey, 'expected request cache key to vary by request kind');
for (const change of [{ virtualPath: 'package-b/source.py' }, { uri: 'file:///repo/package-b/source.py' },
  { containerPath: 'package-b/source.py' }, { segmentUid: 'different-segment' }, { segmentId: 'other' },
  { segmentStart: 20 }, { segmentEnd: 100 }, { languageId: 'cpp' },
  { positionEncoding: 'utf-8' }, { generation: 'next-build' }]) {
  assert.notEqual(buildLspRequestCacheKey({ ...baseInput, ...change }), alphaFunctionKey,
    `identical source bytes cannot erase response authority: ${JSON.stringify(change)}`);
}
assert.equal(buildLspRequestCacheKey({ ...baseInput, uri: null, virtualPath: null }), null);
assert.equal(buildLspRequestCacheKey({ ...baseInput, generation: null }), null);

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
assert.equal(alphaPositionKey, betaPositionKey, 'expected symbol-position key to be position-only');

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

const state = await loadLspRequestCache(tempRoot);
assert.equal(
  state.path.endsWith(path.join('lsp', 'request-cache-v1.json')),
  true,
  'expected request cache filename'
);
state.entries.set(alphaFunctionKey, {
  requestKind: 'hover',
  info: {
    signature: 'int alpha()',
    returnType: 'int'
  },
  at: 1234
});
await persistLspRequestCache({
  cachePath: state.path,
  entries: state.entries,
  maxEntries: 1000
});
const persisted = JSON.parse(await fs.readFile(state.path, 'utf8'));
assert.equal(persisted?.version, 1, 'expected persisted request cache schema version 1');
persisted.entries.push({ key: 'rq1|ambiguous-old-answer', value: persisted.entries[0].value });
await fs.writeFile(state.path, JSON.stringify(persisted));
const reloaded = await loadLspRequestCache(tempRoot);
assert.equal(reloaded.entries.has('rq1|ambiguous-old-answer'), false, 'legacy ambiguous entries are not admitted');
assert.ok(reloaded.entries.has(alphaFunctionKey), 'current scoped entries remain reusable');

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('LSP request cache key test passed');
