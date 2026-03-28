#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createTypeScriptProvider } from '../../../src/index/tooling/typescript-provider.js';

const provider = createTypeScriptProvider();
const root = process.cwd();
const baseToolingConfig = {
  typescript: { allowJs: true, checkJs: true, includeJsx: true, useTsconfig: false }
};

const cases = [
  {
    name: 'vue vfs segments preserve file identity',
    strict: true,
    documents: [{
      virtualPath: '.poc-vfs/src/App.vue#seg:stub.ts',
      text: 'export function greet(name: string) { return name; }\n',
      languageId: 'typescript',
      effectiveExt: '.ts'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid: 'ck64:v1:test:src/App.vue:deadbeef',
        chunkId: 'chunk_deadbeef',
        file: 'src/App.vue',
        segmentUid: 'seg-stub',
        segmentId: 'seg-stub',
        range: { start: 0, end: 'export function greet(name: string) { return name; }\n'.length }
      },
      virtualPath: '.poc-vfs/src/App.vue#seg:stub.ts',
      virtualRange: { start: 0, end: 'export function greet(name: string) { return name; }\n'.length },
      symbolHint: { name: 'greet', kind: 'function' }
    }],
    assertResult(result) {
      const entry = result.byChunkUid?.['ck64:v1:test:src/App.vue:deadbeef'];
      assert.ok(entry, 'expected TypeScript provider to return an entry for VFS target');
      assert.equal(entry.payload.returnType, 'string');
    }
  },
  {
    name: 'node matching uses target ranges to disambiguate duplicates',
    strict: true,
    setup() {
      const docText = ['class A { dup() { return 1; } }', 'class B { dup() { return "x"; } }', ''].join('\n');
      const virtualPath = '.poc-vfs/src/dups.ts#seg:stub.ts';
      const firstMethod = 'dup() { return 1; }';
      const secondMethod = 'dup() { return "x"; }';
      const firstStart = docText.indexOf(firstMethod);
      const secondStart = docText.indexOf(secondMethod);
      return {
        documents: [{
          virtualPath,
          text: docText,
          languageId: 'typescript',
          effectiveExt: '.ts'
        }],
        targets: [
          {
            chunkRef: {
              docId: 0,
              chunkUid: 'ck64:v1:test:src/dups.ts:first',
              chunkId: 'chunk_first',
              file: 'src/dups.ts',
              segmentUid: null,
              segmentId: null,
              range: { start: firstStart, end: firstStart + firstMethod.length }
            },
            virtualPath,
            virtualRange: { start: firstStart, end: firstStart + firstMethod.length },
            symbolHint: { name: 'dup', kind: 'method' }
          },
          {
            chunkRef: {
              docId: 1,
              chunkUid: 'ck64:v1:test:src/dups.ts:second',
              chunkId: 'chunk_second',
              file: 'src/dups.ts',
              segmentUid: null,
              segmentId: null,
              range: { start: secondStart, end: secondStart + secondMethod.length }
            },
            virtualPath,
            virtualRange: { start: secondStart, end: secondStart + secondMethod.length },
            symbolHint: { name: 'dup', kind: 'method' }
          }
        ]
      };
    },
    assertResult(result) {
      const first = result.byChunkUid?.['ck64:v1:test:src/dups.ts:first'];
      const second = result.byChunkUid?.['ck64:v1:test:src/dups.ts:second'];
      assert.ok(first && second, 'expected both targets to resolve');
      assert.equal(first.payload.returnType, 'number');
      assert.equal(second.payload.returnType, 'string');
    }
  },
  {
    name: 'ambiguous fallback refuses to guess',
    strict: false,
    setup() {
      const docText = ['class A { dup() { return 1; } }', 'class B { dup() { return "x"; } }', ''].join('\n');
      const virtualPath = '.poc-vfs/src/dups.ts#seg:stub.ts';
      return {
        documents: [{
          virtualPath,
          text: docText,
          languageId: 'typescript',
          effectiveExt: '.ts'
        }],
        targets: [{
          chunkRef: {
            docId: 0,
            chunkUid: 'ck64:v1:test:src/dups.ts:ambiguous',
            chunkId: 'chunk_ambiguous',
            file: 'src/dups.ts',
            segmentUid: null,
            segmentId: null,
            range: { start: 0, end: docText.length }
          },
          virtualPath,
          virtualRange: { start: 0, end: docText.length },
          symbolHint: { name: 'dup', kind: 'method' }
        }]
      };
    },
    assertResult(result) {
      assert.ok(!result.byChunkUid?.['ck64:v1:test:src/dups.ts:ambiguous'], 'expected ambiguous fallback to avoid guessing');
    }
  },
  {
    name: 'destructured parameter names are normalized',
    strict: true,
    setup() {
      const docText = 'function f({ a, b }, [c]) { return a + c; }\n';
      const virtualPath = '.poc-vfs/src/destructure.ts#seg:stub.ts';
      const start = docText.indexOf('function f');
      const end = docText.length;
      return {
        documents: [{
          virtualPath,
          text: docText,
          languageId: 'typescript',
          effectiveExt: '.ts'
        }],
        targets: [{
          chunkRef: {
            docId: 0,
            chunkUid: 'ck64:v1:test:src/destructure.ts:one',
            chunkId: 'chunk_one',
            file: 'src/destructure.ts',
            segmentUid: null,
            segmentId: null,
            range: { start, end }
          },
          virtualPath,
          virtualRange: { start, end },
          symbolHint: { name: 'f', kind: 'function' }
        }]
      };
    },
    assertResult(result) {
      const entry = result.byChunkUid?.['ck64:v1:test:src/destructure.ts:one'];
      assert.ok(entry, 'expected tooling entry');
      const paramTypes = entry.payload?.paramTypes || {};
      assert.ok(paramTypes['{a,b}'], 'expected normalized object pattern param name');
      assert.ok(paramTypes['[c]'], 'expected normalized array pattern param name');
    }
  }
];

for (const testCase of cases) {
  const setup = typeof testCase.setup === 'function'
    ? testCase.setup()
    : { documents: testCase.documents, targets: testCase.targets };
  const result = await provider.run({
    repoRoot: root,
    buildRoot: root,
    toolingConfig: baseToolingConfig,
    strict: testCase.strict,
    logger: () => {}
  }, setup);
  testCase.assertResult(result);
}

console.log('TypeScript tooling contract matrix test passed');
