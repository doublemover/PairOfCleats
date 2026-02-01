#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

const makeSymbol = (name, uid, file) => ({
  scheme: 'poc',
  symbolId: `sym:${uid}`,
  scopedId: `scope:${uid}`,
  symbolKey: `symkey:${name}`,
  qualifiedName: name,
  kindGroup: 'function',
  chunkUid: uid,
  file
});

const chunks = [
  {
    file: 'src/one.js',
    name: 'Dup',
    kind: 'function',
    chunkUid: 'uid-one',
    metaV2: {
      file: 'src/one.js',
      virtualPath: 'src/one.js',
      chunkUid: 'uid-one',
      symbol: makeSymbol('Dup', 'uid-one', 'src/one.js')
    }
  },
  {
    file: 'src/two.js',
    name: 'Dup',
    kind: 'function',
    chunkUid: 'uid-two',
    metaV2: {
      file: 'src/two.js',
      virtualPath: 'src/two.js',
      chunkUid: 'uid-two',
      symbol: makeSymbol('Dup', 'uid-two', 'src/two.js')
    }
  },
  {
    file: 'src/caller.js',
    name: 'caller',
    kind: 'function',
    chunkUid: 'uid-caller',
    metaV2: {
      file: 'src/caller.js',
      virtualPath: 'src/caller.js',
      chunkUid: 'uid-caller',
      symbol: makeSymbol('caller', 'uid-caller', 'src/caller.js')
    },
    codeRelations: {
      calls: [[0, 'Dup']]
    }
  }
];

await applyCrossFileInference({
  rootDir: process.cwd(),
  buildRoot: process.cwd(),
  chunks,
  enabled: true,
  useTooling: false,
  enableTypeInference: false,
  enableRiskCorrelation: false,
  fileRelations: new Map()
});

const caller = chunks.find((chunk) => chunk.chunkUid === 'uid-caller');
const callLinks = caller?.codeRelations?.callLinks || [];
assert.equal(callLinks.length, 1, 'expected a single call link');
assert.equal(callLinks[0]?.to?.status, 'ambiguous', 'expected ambiguous symbol ref');
assert.equal(callLinks[0]?.to?.candidates?.length, 2, 'expected two candidates');
assert.ok(!callLinks[0]?.legacy, 'expected ambiguous links to omit legacy target');

console.log('symbol edges ambiguous test passed');
