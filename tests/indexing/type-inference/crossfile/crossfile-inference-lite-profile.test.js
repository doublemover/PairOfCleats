#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../../helpers/test-env.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'crossfile-inference-lite-profile');
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
      inferredTypes: { returns: [{ type: 'string', source: 'declared', confidence: 0.9 }] },
      risk: {
        sinks: [{ name: 'db.exec', category: 'sql-injection', severity: 'high', ruleId: 'sink-rule' }],
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
      callDetails: [{ callee: 'sinkFn', args: ['"abc"'] }]
    },
    docmeta: {
      risk: {
        sources: [{ name: 'http.input', ruleId: 'source-rule', confidence: 0.8 }]
      }
    }
  }
]);

const runMode = async ({ inferenceLite }) => {
  const chunks = createChunks();
  const stats = await applyCrossFileInference({
    rootDir: tempRoot,
    buildRoot: tempRoot,
    cacheEnabled: false,
    chunks,
    enabled: true,
    enableTypeInference: true,
    enableRiskCorrelation: true,
    inferenceLite,
    inferenceLiteHighSignalOnly: true,
    fileRelations: null,
    log: () => {}
  });
  return { chunks, stats };
};

const full = await runMode({ inferenceLite: false });
const lite = await runMode({ inferenceLite: true });

assert.ok(full.stats.linkedCalls > 0, 'expected full mode to emit call links');
assert.ok(full.stats.inferredReturns > 0, 'expected full mode to infer return types');
assert.ok(full.stats.riskFlows > 0, 'expected full mode to emit risk flows');

assert.ok(lite.stats.linkedCalls > 0, 'expected lite mode to preserve call link emission');
assert.equal(lite.stats.inferredReturns, 0, 'expected lite mode to skip return inference');
assert.equal(lite.stats.riskFlows, 0, 'expected lite mode to skip risk propagation');
assert.equal(lite.stats.inferenceLiteEnabled, true, 'expected lite-mode telemetry flag');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('cross-file inference lite profile test passed');
