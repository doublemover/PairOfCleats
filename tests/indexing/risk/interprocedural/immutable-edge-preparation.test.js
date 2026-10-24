import assert from 'node:assert/strict';
import { computeInterproceduralRisk } from '../../../../src/index/risk-interprocedural/engine.js';
import { buildRiskSummaries } from '../../../../src/index/risk-interprocedural/summaries.js';
import { createRiskRuntime, createRiskSourceChunk, createRiskSinkChunk } from './helpers/risk-flow-fixtures.js';
const call = targetChunkUid => ({ callee: targetChunkUid, calleeRaw: targetChunkUid, calleeNormalized: targetChunkUid,
  targetChunkUid, args: ['value'], startLine: 2, startCol: 1, endLine: 2, endCol: 10 });
const middle = (uid, targets) => ({ chunkUid: uid, file: `${uid}.js`, name: uid, docmeta: {},
  codeRelations: { callDetails: targets.map(call) } });
const source = createRiskSourceChunk();
source.codeRelations.callDetails = [call('left'), call('right')];
const sink = createRiskSinkChunk();
const chunks = [source, middle('left', ['join']), middle('right', ['join']), middle('join', ['uid-sink']), sink];
const runtime = createRiskRuntime({ caps: { maxDepth: 4, maxPathsPerPair: 2 } });
const { rows } = buildRiskSummaries({ chunks, runtime, mode: 'code' });
let sinkReads = 0, parameterReads = 0;
const row = rows.find(entry => entry.chunkUid === 'uid-sink'), sinks = row.signals.sinks;
Object.defineProperty(row.signals, 'sinks', { get() { sinkReads++; return sinks; } });
Object.defineProperty(sink.docmeta, 'paramNames', { get() { parameterReads++; return ['value']; } });
const result = computeInterproceduralRisk({ chunks, summaries: rows, runtime });
assert.equal(result.flowRows.length, 2);
assert.equal(sinkReads, 1, 'converging states reuse one sorted sink list');
assert.equal(parameterReads, 2, 'parameter metadata is resolved once for the immutable join edge');
assert.equal(new Set(result.flowRows.map(flow => flow.flowId)).size, 2);
console.log('Immutable risk edge preparation is shared without merging distinct propagation witnesses.');
