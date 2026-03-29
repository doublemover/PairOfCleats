#!/usr/bin/env node
import assert from 'node:assert/strict';

import { assignChunkUids } from '../../../src/index/identity/chunk-uid.js';
import { buildSymbolIdentity } from '../../../src/index/identity/symbol.js';
import { toKindGroup } from '../../../src/index/identity/kind-group.js';
import {
  assertChunkIdentityEnvelope,
  assertSegmentIdentityEnvelope,
  buildChunkIdentityEnvelopeFromArtifactRow,
  buildScopedSymbolId,
  buildSignatureKey,
  buildSymbolId,
  buildSymbolKey,
  isCanonicalChunkUid,
  resolveChunkJoinKey,
  resolveSymbolJoinKey
} from '../../../src/shared/identity.js';
import { sha1 } from '../../../src/shared/hash.js';

{
  const row = {
    id: 7,
    chunkUid: 'ck64:v1:repo:src/app.js#seg:segu:v1:abcd1234:0011223344556677',
    chunkId: 'chunk_7',
    file: 'src/app.js',
    virtualPath: 'src/app.js#seg:segu:v1:abcd1234',
    start: 12,
    end: 48,
    metaV2: {
      segment: {
        segmentUid: 'segu:v1:abcd1234',
        segmentId: 'seg-7',
        languageId: 'javascript'
      }
    }
  };
  const identity = buildChunkIdentityEnvelopeFromArtifactRow(row);
  assert.equal(identity.docId, 7);
  assert.equal(identity.segmentUid, 'segu:v1:abcd1234');
  assert.deepEqual(identity.range, { start: 12, end: 48 });
  assert.equal(assertChunkIdentityEnvelope(identity, {
    label: 'chunk_meta',
    requireChunkUid: true,
    requireVirtualPath: true,
    requireSegmentUid: true
  }).chunkUid, row.chunkUid);
  assert.equal(assertSegmentIdentityEnvelope({
    segmentUid: identity.segmentUid,
    virtualPath: identity.virtualPath
  }, {
    label: 'segment',
    requireSegmentUid: true,
    requireVirtualPath: true
  }).segmentUid, identity.segmentUid);
  assert.throws(() => assertChunkIdentityEnvelope({ virtualPath: 'src/missing.js' }, {
    label: 'chunk_meta',
    requireChunkUid: true
  }), /chunk_meta missing chunkUid/);
}

for (const testCase of [
  {
    name: 'canonical-envelope',
    fileRelPath: 'src/dart-generated.g.dart',
    fileText: 'String serialize() => toJson();\n',
    chunks: [
      { file: 'src/dart-generated.g.dart', start: 0, end: 'String serialize() => toJson();\n'.length, kind: 'FunctionDeclaration', name: 'serialize' },
      { file: 'src/dart-generated.g.dart', start: 0, end: 'String serialize() => toJson();\n'.length, kind: 'MethodDeclaration', name: 'serialize' }
    ],
    assertResult(resultChunks) {
      assert.notEqual(resultChunks[0].chunkUid, resultChunks[1].chunkUid);
      assert.equal(resultChunks[0].identity?.disambiguation, 'canonical-envelope');
      assert.equal(resultChunks[1].identity?.disambiguation, 'canonical-envelope');
      assert.equal(String(resultChunks[0].chunkUid).includes(':ord'), false);
      assert.equal(String(resultChunks[1].chunkUid).includes(':ord'), false);
    }
  },
  {
    name: 'collision-disambiguation',
    fileRelPath: 'src/collisions.js',
    fileText: `${'A'.repeat(200)}function dup() { return 1; }\n${'B'.repeat(200)}${'A'.repeat(200)}function dup() { return 1; }\n${'B'.repeat(200)}`,
    chunks: (() => {
      const prefix = 'A'.repeat(200);
      const chunkText = 'function dup() { return 1; }\n';
      const suffix = 'B'.repeat(200);
      const firstStart = prefix.length;
      const firstEnd = firstStart + chunkText.length;
      const secondStart = firstEnd + suffix.length + prefix.length;
      const secondEnd = secondStart + chunkText.length;
      return [
        { file: 'src/collisions.js', start: firstStart, end: firstEnd, kind: 'FunctionDeclaration', name: 'dup' },
        { file: 'src/collisions.js', start: secondStart, end: secondEnd, kind: 'FunctionDeclaration', name: 'dup' }
      ];
    })(),
    assertResult(resultChunks) {
      assert.notEqual(resultChunks[0].chunkUid, resultChunks[1].chunkUid);
      assert.equal(String(resultChunks[0].chunkUid).includes(':ord'), false);
      assert.equal(String(resultChunks[1].chunkUid).includes(':ord'), false);
    }
  }
]) {
  await assignChunkUids({
    chunks: testCase.chunks,
    fileText: testCase.fileText,
    fileRelPath: testCase.fileRelPath,
    strict: true
  });
  testCase.assertResult(testCase.chunks);
}

{
  const fileRelPath = 'src/ordinal-collisions.js';
  const pre = 'A'.repeat(2000);
  const chunkText = 'function dup() { return 1; }\n';
  const post = 'B'.repeat(2000);
  const fileText = `${pre}${chunkText}${post}`;
  const firstStart = pre.length;
  const firstEnd = firstStart + chunkText.length;
  const firstChunk = { file: fileRelPath, start: firstStart, end: firstEnd, kind: 'FunctionDeclaration', name: 'dup' };
  const secondChunk = { file: fileRelPath, start: firstStart, end: firstEnd, kind: 'FunctionDeclaration', name: 'dup' };
  const chunks = [secondChunk, firstChunk];
  const result = await assignChunkUids({ chunks, fileText, fileRelPath, strict: true });
  assert.equal(result.collisions.collisionGroups, 1);
  assert.equal(result.collisions.escalated, 1);
  assert.equal(result.collisions.ordinal, 1);
  assert.notEqual(firstChunk.chunkUid, secondChunk.chunkUid);
  const ordinalSuffixes = [firstChunk.chunkUid, secondChunk.chunkUid]
    .map((value) => String(value).match(/:ord([0-9]+)$/)?.[1] || null)
    .sort();
  assert.deepEqual(ordinalSuffixes, ['1', '2']);
  assert.equal(firstChunk.identity?.collisionOf, secondChunk.identity?.collisionOf);
  assert.equal(isCanonicalChunkUid(firstChunk.chunkUid), true);
  assert.equal(isCanonicalChunkUid(secondChunk.chunkUid), true);
}

{
  const fileRelPath = 'src/sample.js';
  const prefix = 'A'.repeat(200);
  const chunkText = 'function greet() { return 1; }\n';
  const suffix = 'B'.repeat(200);
  const fileText = `${prefix}${chunkText}${suffix}`;
  const chunk = {
    file: fileRelPath,
    start: prefix.length,
    end: prefix.length + chunkText.length,
    kind: 'FunctionDeclaration',
    name: 'greet'
  };
  await assignChunkUids({ chunks: [chunk], fileText, fileRelPath, strict: true });
  const shiftedChunk = {
    file: fileRelPath,
    start: prefix.length + '// header comment\n// another line\n'.length,
    end: prefix.length + '// header comment\n// another line\n'.length + chunkText.length,
    kind: 'FunctionDeclaration',
    name: 'greet'
  };
  await assignChunkUids({
    chunks: [shiftedChunk],
    fileText: `// header comment\n// another line\n${fileText}`,
    fileRelPath,
    strict: true
  });
  assert.equal(shiftedChunk.chunkUid, chunk.chunkUid);
}

{
  const symbolA = { symbolId: 'scip:local foo', scopedId: 'sid:v1:1', symbolKey: 'sk:v1:1' };
  const symbolB = { scopedId: 'sid:v1:2', symbolKey: 'sk:v1:2' };
  const symbolC = { symbolKey: 'sk:v1:3' };
  assert.equal(resolveSymbolJoinKey(symbolA)?.type, 'symbolId');
  assert.equal(resolveSymbolJoinKey(symbolB)?.type, 'scopedId');
  assert.equal(resolveSymbolJoinKey(symbolC, { allowSymbolKey: true })?.type, 'symbolKey');
  const chunkA = { chunkUid: 'ck64:v1:repo:src/a.js:deadbeef', chunkId: 'chunk_dead', file: 'src/a.js', segmentUid: 'seg1' };
  const chunkB = { chunkId: 'chunk_dead', file: 'src/a.js', segmentUid: 'seg1' };
  assert.equal(resolveChunkJoinKey(chunkA)?.type, 'chunkUid');
  assert.equal(resolveChunkJoinKey(chunkB)?.type, 'legacy');
  assert.equal(resolveSymbolJoinKey('raw-symbol'), null);
  assert.equal(resolveSymbolJoinKey({ symbolKey: 'sk:v1:abc' }), null);
  assert.equal(resolveSymbolJoinKey({ symbolKey: 'sk:v1:abc' }, { allowSymbolKey: true })?.key, 'sk:v1:abc');
}

{
  const cases = new Map([
    ['function', 'function'],
    ['arrow_function', 'function'],
    ['generator', 'function'],
    ['class', 'class'],
    ['method', 'method'],
    ['constructor', 'method'],
    ['interface', 'type'],
    ['type', 'type'],
    ['enum', 'type'],
    ['variable', 'value'],
    ['const', 'value'],
    ['let', 'value'],
    ['module', 'module'],
    ['namespace', 'module'],
    ['file', 'module'],
    ['unknown', 'other'],
    [null, 'other'],
    ['', 'other']
  ]);
  for (const [input, expected] of cases.entries()) {
    assert.equal(toKindGroup(input), expected, `kindGroup(${input})`);
  }
}

{
  const meta = {
    chunkUid: 'ck64:v1:repo:src/alpha.js:0123456789abcdef',
    virtualPath: 'src/alpha.js',
    name: 'Alpha',
    kind: 'function',
    lang: 'javascript',
    signature: 'function Alpha(a, b)'
  };
  const symbol = buildSymbolIdentity({ metaV2: meta });
  assert.ok(symbol);
  assert.equal(symbol.kindGroup, 'function');
  assert.equal(symbol.symbolKey, 'src/alpha.js::Alpha::function');
  assert.equal(symbol.signatureKey, 'Alpha::function Alpha(a, b)');
  assert.ok(symbol.symbolId?.startsWith('sym1:heur:'));
  assert.equal(buildSymbolIdentity({ metaV2: { ...meta, lang: null } }), null);
  assert.equal(buildSymbolIdentity({ metaV2: { ...meta, name: null } }), null);
  assert.equal(buildSymbolIdentity({ metaV2: { ...meta, chunkUid: 'uid-alpha' } }), null);

  const symbolKey = buildSymbolKey({ virtualPath: 'src/app.js', qualifiedName: 'Widget', kindGroup: 'class' });
  const signatureKey = buildSignatureKey({ qualifiedName: 'Widget', signature: '  class Widget<T>  ' });
  const scopedId = buildScopedSymbolId({
    kindGroup: 'class',
    symbolKey,
    signatureKey,
    chunkUid: 'uid-widget'
  });
  assert.equal(symbolKey, 'src/app.js::Widget::class');
  assert.equal(signatureKey, 'Widget::class Widget<T>');
  assert.equal(scopedId, `class|${symbolKey}|${signatureKey}|uid-widget`);
  assert.equal(buildSymbolId({ scopedId, scheme: 'heur' }), `sym1:heur:${sha1(scopedId)}`);
}

console.log('identity contract matrix test passed');
