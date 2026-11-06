import { buildRiskSummaries } from '../../src/index/risk-interprocedural/summaries.js';
import { createRiskRuntime, createRiskSourceChunk, createRiskSinkChunk } from '../indexing/risk/interprocedural/helpers/risk-flow-fixtures.js';

export const riskWitnessCall = (targetChunkUid, line = 2) => ({ callee: targetChunkUid, calleeRaw: targetChunkUid,
  calleeNormalized: targetChunkUid, targetChunkUid, args: ['value'], startLine: line,
  startCol: 1, endLine: line, endCol: 10 });
export const riskWitnessMiddle = (uid, targets) => ({ chunkUid: uid, file: `${uid}.js`, name: uid,
  kind: 'Function', startLine: 1, docmeta: {}, codeRelations: { callDetails: targets.map((id, i) => riskWitnessCall(id, i + 1)) } });

/** A constant-width frontier with many consumed leaf states and one shared
 * spine. Only the final spine endpoint emits: output storage cannot hide the
 * cost of retaining terminal witnesses that no descendant needs. */
export const riskSpineScenario = ({ depth, width }) => {
  const source = createRiskSourceChunk(), sink = createRiskSinkChunk(), chunks = [source];
  let current = source;
  for (let step = 1; step <= depth; step++) {
    const leaves = Array.from({ length: width }, (_, i) => `leaf-${String(step).padStart(2, '0')}-${String(i).padStart(4, '0')}`);
    const next = step === depth ? sink : riskWitnessMiddle(`spine-${String(step).padStart(2, '0')}`, []);
    current.codeRelations = { callDetails: [...leaves, next.chunkUid].map((id, i) => riskWitnessCall(id, i + 1)) };
    chunks.push(...leaves.map(id => riskWitnessMiddle(id, [])), next); current = next;
  }
  const runtime = createRiskRuntime({ caps: { maxDepth: depth, maxPathsPerPair: 3, maxPartialFlows: 0,
    maxTotalFlows: 1, maxEdgeExpansions: depth * (width + 1) + 1, maxMs: null } });
  return { chunks, runtime, depth, width };
};

/** Shared-prefix branching at an authored depth, with one accepted complete
 * output per distinct leaf. Every branch keeps its own call-site/watch order. */
export const riskBranchScenario = ({ depth, width }) => {
  const source = createRiskSourceChunk(), chunks = [source];
  let current = source;
  for (let step = 1; step < depth; step++) {
    const next = riskWitnessMiddle(`shared-${step}`, []);
    current.codeRelations = { callDetails: [riskWitnessCall(next.chunkUid)] };
    chunks.push(next); current = next;
  }
  const sinks = Array.from({ length: width }, (_, i) => ({ ...createRiskSinkChunk(), chunkUid: `sink-${i}`, file: `sink-${i}.js` }));
  current.codeRelations = { callDetails: sinks.map((sink, i) => riskWitnessCall(sink.chunkUid, i + 1)) };
  chunks.push(...sinks);
  const runtime = createRiskRuntime({ caps: { maxDepth: depth, maxPathsPerPair: 3, maxPartialFlows: 0,
    maxTotalFlows: width + 1, maxEdgeExpansions: width + depth + 1, maxMs: null } });
  return { chunks, runtime, depth, width };
};

export const riskDiamondScenario = () => {
  const source = createRiskSourceChunk(), sink = createRiskSinkChunk();
  source.codeRelations.callDetails = [riskWitnessCall('left', 2), riskWitnessCall('right', 3)];
  return { chunks: [source, riskWitnessMiddle('left', ['join']), riskWitnessMiddle('right', ['join']),
    riskWitnessMiddle('join', ['uid-sink']), sink], runtime: createRiskRuntime({ caps: {
    maxDepth: 4, maxPathsPerPair: 2, maxPartialFlows: 16, maxBlockedExpansionsPerPartial: 4 } }) };
};

export const riskScenarioInput = scenario => ({ chunks: scenario.chunks, runtime: scenario.runtime,
  summaries: buildRiskSummaries({ chunks: scenario.chunks, runtime: scenario.runtime, mode: 'code' }).rows });
