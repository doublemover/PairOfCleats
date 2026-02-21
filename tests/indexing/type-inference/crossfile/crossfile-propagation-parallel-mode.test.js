#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../../helpers/test-env.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

applyTestEnv({
  testing: '1',
  extraEnv: {
    PAIROFCLEATS_CROSSFILE_PROPAGATION_PARALLEL: '1',
    PAIROFCLEATS_CROSSFILE_PROPAGATION_PARALLEL_MIN_BUNDLE: '1'
  }
});

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'crossfile-propagation-parallel-mode');
const srcDir = path.join(tempRoot, 'src');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcDir, { recursive: true });

const calleeText = 'export function sinkFn(value) { return value; }\n';
const callerText = 'export function caller(input) { return sinkFn("abc"); }\n';
await fs.writeFile(path.join(srcDir, 'callee.js'), calleeText, 'utf8');
await fs.writeFile(path.join(srcDir, 'caller.js'), callerText, 'utf8');

const createChunks = () => ([
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
      paramNames: ['value'],
      risk: {
        sinks: [
          {
            name: 'db.exec',
            category: 'sql-injection',
            severity: 'high',
            ruleId: 'sink-rule'
          }
        ],
        tags: ['security']
      }
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
    docmeta: {
      risk: {
        sources: [
          {
            name: 'http.input',
            ruleId: 'source-rule',
            confidence: 0.8
          }
        ]
      }
    }
  }
]);

const runOnce = async () => {
  const logs = [];
  const chunks = createChunks();
  const stats = await applyCrossFileInference({
    rootDir: tempRoot,
    buildRoot: tempRoot,
    cacheEnabled: false,
    chunks,
    enabled: true,
    enableTypeInference: true,
    enableRiskCorrelation: true,
    log: (line) => logs.push(String(line || '')),
    fileRelations: null
  });
  return { stats, logs, chunks };
};

const first = await runOnce();
const second = await runOnce();

assert.ok(
  first.logs.some((line) => line.includes('cross-file propagation parallel mode enabled')),
  'expected propagation parallel mode log when bundle threshold is met'
);
assert.ok(first.stats.linkedCalls >= 1, 'expected call links to be generated');
assert.ok(first.stats.riskFlows >= 1, 'expected risk flow propagation to run');

const callee = first.chunks.find((chunk) => chunk.chunkUid === 'uid:callee');
const caller = first.chunks.find((chunk) => chunk.chunkUid === 'uid:caller');
assert.ok(callee, 'expected callee chunk');
assert.ok(caller, 'expected caller chunk');
const inferredParams = callee.docmeta?.inferredTypes?.params?.value || [];
assert.ok(
  inferredParams.some((entry) => entry.type === 'string' && entry.source === 'flow'),
  'expected type propagation to infer string param type on callee'
);
assert.ok(
  Array.isArray(caller.docmeta?.risk?.flows) && caller.docmeta.risk.flows.length > 0,
  'expected risk propagation to add cross-file flow on caller chunk'
);

const snapshot = (run) => JSON.stringify(
  run.chunks.map((chunk) => ({
    uid: chunk.chunkUid,
    callLinks: chunk.codeRelations?.callLinks || [],
    callSummaries: chunk.codeRelations?.callSummaries || [],
    inferredParams: chunk.docmeta?.inferredTypes?.params || null,
    riskFlows: chunk.docmeta?.risk?.flows || []
  }))
);
assert.equal(snapshot(second), snapshot(first), 'parallel propagation should remain deterministic');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('cross-file propagation parallel mode test passed');
