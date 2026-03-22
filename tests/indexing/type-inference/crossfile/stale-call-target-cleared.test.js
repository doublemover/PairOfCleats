#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'crossfile-stale-call-target-cleared');
const srcDir = path.join(tempRoot, 'src');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcDir, { recursive: true });

const callerText = 'export function caller() { return util(); }\n';
await fs.writeFile(path.join(srcDir, 'index.js'), callerText, 'utf8');

const staleTargetChunkUid = 'ck64:v1:repo:src/util.js#seg:segu:v1:stale:1111222233334444';
const chunks = [
  {
    chunkUid: 'ck64:v1:repo:src/index.js#seg:segu:v1:caller:aaaabbbbccccdddd',
    file: 'src/index.js',
    name: 'caller',
    kind: 'function',
    start: 0,
    end: callerText.length,
    metaV2: {
      symbol: {
        symbolId: 'sym:caller',
        symbolKey: 'src/index.js::caller',
        chunkUid: 'ck64:v1:repo:src/index.js#seg:segu:v1:caller:aaaabbbbccccdddd'
      }
    },
    codeRelations: {
      callDetails: [
        {
          caller: 'caller',
          callee: 'util',
          args: [],
          targetChunkUid: staleTargetChunkUid,
          resolvedCalleeChunkUid: staleTargetChunkUid,
          targetCandidates: [staleTargetChunkUid]
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
  enableTypeInference: false,
  enableRiskCorrelation: false,
  fileRelations: null
});

assert.equal(stats.linkedCalls, 0, 'expected no linked calls when the callee no longer resolves');
const detail = chunks[0].codeRelations.callDetails[0];
assert.equal(detail.targetChunkUid, null, 'expected stale targetChunkUid to be cleared');
assert.equal(detail.resolvedCalleeChunkUid, null, 'expected stale resolved callee uid to be cleared');
assert.deepEqual(detail.targetCandidates, [], 'expected stale target candidates to be cleared');
assert.equal(detail.calleeRef?.status, 'unresolved', 'expected unresolved symbol ref to be retained for diagnostics');
assert.ok(
  !Array.isArray(chunks[0].codeRelations.callSummaries) || chunks[0].codeRelations.callSummaries.every((entry) => !entry.targetChunkUid),
  'expected call summaries to avoid stale targetChunkUid values'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('crossfile stale call target cleared test passed');
