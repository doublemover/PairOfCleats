import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const key = Symbol.for('poc.risk-sampling-run-memo');
const actualEdges = new URL('../../../../src/index/risk-interprocedural/edges.js', import.meta.url).href;
globalThis[key] = [];
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './edges.js' && context.parentURL?.endsWith('/risk-interprocedural/engine.js'))
      return { url: 'poc:risk-sampling-run-memo', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'poc:risk-sampling-run-memo') return { format: 'module', shortCircuit: true,
      source: `import * as actual from ${JSON.stringify(actualEdges)}; export const edgeKey=actual.edgeKey;
        export const sampleCallSitesForEdge=(details,options)=>{globalThis[Symbol.for('poc.risk-sampling-run-memo')].push(options);return actual.sampleCallSitesForEdge(details,options)};` };
    return nextLoad(url, context);
  }
});
try {
  const { computeRiskScenario, createRiskRuntime, createRiskSourceChunk, createRiskSinkChunk } = await import('./helpers/risk-flow-fixtures.js');
  const call = (targetChunkUid, line) => ({ callee: targetChunkUid, calleeRaw: targetChunkUid,
    calleeNormalized: targetChunkUid, targetChunkUid, args: ['value'], startLine: line,
    startCol: 1, endLine: line, endCol: 10 });
  const middle = (uid, targets) => ({ chunkUid: uid, file: `${uid}.js`, name: uid,
    kind: 'Function', startLine: 1, docmeta: {}, codeRelations: { callDetails: targets.map((target, id) => call(target, id + 1)) } });
  const source = createRiskSourceChunk();
  source.codeRelations.callDetails = [call('uid-left', 2), call('uid-right', 3)];
  const chunks = [source, middle('uid-left', ['uid-join']), middle('uid-right', ['uid-join']),
    middle('uid-join', ['uid-sink']), createRiskSinkChunk()];
  const runtime = createRiskRuntime({ caps: { maxDepth: 4, maxPathsPerPair: 2 } });
  const first = computeRiskScenario({ chunks, runtime });
  assert.equal(first.flowRows.length, 2, 'sampling reuse preserves both converging witnesses');
  assert.equal(globalThis[key].filter(options => options.calleeUid === 'uid-sink' && options.callerFile === 'uid-join.js').length, 1,
    'the immutable join edge is sampled once despite two propagation states');
  globalThis[key] = [];
  const second = computeRiskScenario({ chunks, runtime: createRiskRuntime({ caps: { maxDepth: 4, maxPathsPerPair: 2, maxCallSitesPerEdge: 1 } }) });
  assert.equal(second.flowRows.length, 2);
  assert.equal(globalThis[key].filter(options => options.calleeUid === 'uid-sink' && options.callerFile === 'uid-join.js').length, 1);
  assert.ok(globalThis[key].every(options => options.maxCallSitesPerEdge === 1), 'new runs own their sampling configuration');
} finally { hooks.deregister(); delete globalThis[key]; }
console.log('Risk propagation memoizes immutable edge sampling within each run while preserving witness state.');
