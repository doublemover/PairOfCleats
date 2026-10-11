import { protocolFailure, TYPESCRIPT_RUNTIME_PROTOCOL_VERSION } from './protocol.js';
import { ToolingRequiredComputationError } from '../../required-computation.js';

// Graph payloads are split at existing immutable node boundaries. This does
// not expand the symbolic graph or stringify an entire provider result.
export async function writeProviderResult(result, write) {
  await write({ type: 'result-start', version: TYPESCRIPT_RUNTIME_PROTOCOL_VERSION });
  let chunks = 0, checks = 0, graphs = 0;
  for (const [key, value] of Object.entries(result)) {
    if (key === 'byChunkUid') {
      for (const chunkUid of Object.keys(value || {})) {
        await write({ type: 'chunk', chunkUid, value: value[chunkUid] }); chunks += 1;
      }
    } else if (key === 'diagnostics' && Array.isArray(value?.checks)) {
      const { checks: entries, ...metadata } = value;
      await write({ type: 'field', key, value: { ...metadata, checks: [] } });
      for (const entry of entries) { await write({ type: 'diagnostic', value: entry }); checks += 1; }
    } else if (key === 'symbolicTypeGraphs') {
      if (!Array.isArray(value)) throw protocolFailure('invalid-graph-inventory');
      await write({ type: 'field', key, value: [] });
      for (const envelope of value) {
        const { graph, ...outer } = envelope;
        const { nodes, ...metadata } = graph;
        if (!Array.isArray(nodes)) throw protocolFailure('invalid-graph-nodes');
        await write({ type: 'graph-start', value: { ...outer, graph: { ...metadata, nodes: [] } } });
        for (const node of nodes) await write({ type: 'graph-node', value: node });
        await write({ type: 'graph-end', nodes: nodes.length }); graphs += 1;
      }
    } else await write({ type: 'field', key, value });
  }
  await write({ type: 'complete', chunks, checks, graphs });
}

export const createResultAssembler = ({ logger } = {}) => {
  const result = { byChunkUid: Object.create(null) };
  const fields = new Set();
  let started = false, complete = false, graph = null;
  let chunks = 0, checks = 0, graphs = 0;
  const accept = record => {
    if (complete) throw protocolFailure('record-after-complete');
    if (record.type === 'failure') throw new ToolingRequiredComputationError(record.message || 'TypeScript subprocess required computation failed.', {
      operation: record.operation || 'typescript-subprocess', reason: record.reason || 'child-required-failure', details: record.details
    });
    if (record.type === 'log') { if (typeof logger === 'function') logger(record.value); return; }
    if (record.type === 'result-start') {
      if (started || record.version !== TYPESCRIPT_RUNTIME_PROTOCOL_VERSION) throw protocolFailure('invalid-result-start');
      started = true; return;
    }
    if (!started) throw protocolFailure('result-not-started');
    if (graph && record.type !== 'graph-node' && record.type !== 'graph-end') throw protocolFailure('unfinished-graph');
    switch (record.type) {
      case 'field':
        if (typeof record.key !== 'string' || record.key === 'byChunkUid' || fields.has(record.key)) throw protocolFailure('duplicate-or-invalid-field');
        fields.add(record.key);
        Object.defineProperty(result, record.key, { value: record.value, enumerable: true, configurable: true });
        break;
      case 'chunk':
        if (typeof record.chunkUid !== 'string' || !record.chunkUid || Object.hasOwn(result.byChunkUid, record.chunkUid)) throw protocolFailure('duplicate-or-invalid-chunk');
        result.byChunkUid[record.chunkUid] = record.value; chunks += 1; break;
      case 'diagnostic':
        if (!Array.isArray(result.diagnostics?.checks)) throw protocolFailure('diagnostic-without-header');
        result.diagnostics.checks.push(record.value); checks += 1; break;
      case 'graph-start':
        if (!Array.isArray(result.symbolicTypeGraphs) || !Array.isArray(record.value?.graph?.nodes)
          || record.value.graph.nodes.length) throw protocolFailure('invalid-graph-start');
        graph = record.value; break;
      case 'graph-node':
        if (!graph) throw protocolFailure('graph-node-without-start');
        graph.graph.nodes.push(record.value); break;
      case 'graph-end':
        if (!graph || graph.graph.nodes.length !== record.nodes) throw protocolFailure('invalid-graph-end');
        result.symbolicTypeGraphs.push(graph); graph = null; graphs += 1; break;
      case 'complete':
        if (!fields.has('provider') || !fields.has('diagnostics') || record.chunks !== chunks
          || record.checks !== checks || record.graphs !== graphs) throw protocolFailure('invalid-completion');
        complete = true; break;
      default: throw protocolFailure('unknown-result-record', { type: record.type });
    }
  };
  return { accept, finish: () => {
    if (!complete || graph) throw protocolFailure('missing-completion');
    return result;
  } };
};
