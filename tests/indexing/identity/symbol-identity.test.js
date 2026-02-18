#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildSymbolIdentity } from '../../../src/index/identity/symbol.js';

const meta = {
  chunkUid: 'ck64:v1:repo:src/alpha.js:0123456789abcdef',
  virtualPath: 'src/alpha.js',
  name: 'Alpha',
  kind: 'function',
  lang: 'javascript',
  signature: 'function Alpha(a, b)'
};

const symbol = buildSymbolIdentity({ metaV2: meta });
assert.ok(symbol, 'expected symbol identity');
assert.equal(symbol.kindGroup, 'function');
assert.equal(symbol.symbolKey, 'src/alpha.js::Alpha::function');
assert.equal(symbol.signatureKey, 'Alpha::function Alpha(a, b)');
assert.ok(symbol.symbolId?.startsWith('sym1:heur:'), 'expected heur symbolId prefix');

const missingLang = buildSymbolIdentity({ metaV2: { ...meta, lang: null } });
assert.equal(missingLang, null, 'expected missing lang to skip symbol identity');

const missingName = buildSymbolIdentity({ metaV2: { ...meta, name: null } });
assert.equal(missingName, null, 'expected missing name to skip symbol identity');

const invalidChunkUid = buildSymbolIdentity({ metaV2: { ...meta, chunkUid: 'uid-alpha' } });
assert.equal(invalidChunkUid, null, 'expected non-canonical chunkUid to skip symbol identity');

console.log('symbol identity tests passed');
