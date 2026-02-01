#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyCrossFileInference } from '../../src/index/type-inference-crossfile/pipeline.js';

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

const target = {
  file: 'src/target.js',
  name: 'Target',
  kind: 'function',
  chunkUid: 'uid-target',
  metaV2: {
    file: 'src/target.js',
    virtualPath: 'src/target.js',
    chunkUid: 'uid-target',
    symbol: makeSymbol('Target', 'uid-target', 'src/target.js')
  }
};

const caller = {
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
    calls: [[0, 'Target']],
    callDetails: [
      {
        callee: 'Target',
        args: ['1'],
        start: 0,
        end: 6
      }
    ]
  }
};

const chunks = [target, caller];

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

const callLinks = caller.codeRelations?.callLinks || [];
assert.ok(callLinks.length, 'expected call links to be created');
assert.equal(callLinks[0]?.to?.status, 'resolved', 'expected resolved SymbolRef');
assert.equal(callLinks[0]?.to?.resolved?.chunkUid, 'uid-target', 'expected resolved chunkUid');

const callSummaries = caller.codeRelations?.callSummaries || [];
assert.ok(callSummaries.length, 'expected call summaries to be created');
assert.equal(callSummaries[0]?.resolvedCalleeChunkUid, 'uid-target', 'expected summary to carry resolved chunkUid');
assert.ok(callSummaries[0]?.calleeRef, 'expected summary calleeRef');

console.log('symbol links by chunkUid test passed');
