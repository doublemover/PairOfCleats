#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../../helpers/test-env.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'crossfile-prototype-param-name-regression');
const srcDir = path.join(tempRoot, 'src');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcDir, { recursive: true });

const calleeText = 'export function sinkFn(toString) { return toString; }\n';
const callerText = 'export function caller(input) { return sinkFn("abc"); }\n';
await fs.writeFile(path.join(srcDir, 'callee.js'), calleeText, 'utf8');
await fs.writeFile(path.join(srcDir, 'caller.js'), callerText, 'utf8');

const chunks = [
  {
    chunkUid: 'uid:callee',
    file: 'src/callee.js',
    name: 'sinkFn',
    kind: 'function',
    start: 0,
    end: calleeText.length,
    metaV2: {
      symbol: {
        symbolId: 'sym:callee',
        symbolKey: 'src/callee.js::sinkFn',
        chunkUid: 'uid:callee'
      }
    },
    codeRelations: {},
    docmeta: {
      paramNames: ['toString']
    }
  },
  {
    chunkUid: 'uid:caller',
    file: 'src/caller.js',
    name: 'caller',
    kind: 'function',
    start: 0,
    end: callerText.length,
    metaV2: {
      symbol: {
        symbolId: 'sym:caller',
        symbolKey: 'src/caller.js::caller',
        chunkUid: 'uid:caller'
      }
    },
    codeRelations: {
      calls: [[0, 'sinkFn']],
      callDetails: [
        {
          callee: 'sinkFn',
          args: ['"abc"']
        }
      ]
    },
    docmeta: {}
  }
];

const stats = await applyCrossFileInference({
  rootDir: tempRoot,
  buildRoot: tempRoot,
  cacheEnabled: false,
  chunks,
  enabled: true,
  enableTypeInference: true,
  enableRiskCorrelation: false,
  log: () => {},
  fileRelations: null
});

assert.ok(stats.linkedCalls >= 1, 'expected call links to be generated');

const callee = chunks.find((chunk) => chunk.chunkUid === 'uid:callee');
assert.ok(callee, 'expected callee chunk');
const inferredParams = callee.docmeta?.inferredTypes?.params?.toString || [];
assert.ok(
  inferredParams.some((entry) => entry.type === 'string' && entry.source === 'flow'),
  'expected flow inference to support prototype-key param names'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('crossfile prototype-key param name regression test passed');
