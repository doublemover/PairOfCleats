#!/usr/bin/env node
import assert from 'node:assert/strict';
import { sha1 } from '../../../src/shared/hash.js';
import { buildSymbolKey, buildSignatureKey, buildScopedSymbolId, buildSymbolId } from '../../../src/shared/identity.js';

const symbolKey = buildSymbolKey({
  virtualPath: 'src/app.js',
  qualifiedName: 'Widget',
  kindGroup: 'class'
});
assert.equal(symbolKey, 'src/app.js::Widget::class');

const signatureKey = buildSignatureKey({ qualifiedName: 'Widget', signature: '  class Widget<T>  ' });
assert.equal(signatureKey, 'Widget::class Widget<T>');

const scopedId = buildScopedSymbolId({
  kindGroup: 'class',
  symbolKey,
  signatureKey,
  chunkUid: 'uid-widget'
});
assert.equal(scopedId, `class|${symbolKey}|${signatureKey}|uid-widget`);

const symbolId = buildSymbolId({ scopedId, scheme: 'heur' });
assert.equal(symbolId, `sym1:heur:${sha1(scopedId)}`);

console.log('identity symbol key/scoped id tests passed');
