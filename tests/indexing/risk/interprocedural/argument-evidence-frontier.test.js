import assert from 'node:assert/strict';
import { buildCodeRelations } from '../../../../src/lang/javascript/relations.js';
import { computeRiskScenario, createRiskRuntime, createRiskSourceChunk, createRiskSinkChunk } from './helpers/risk-flow-fixtures.js';

const run = (args, formals = 'a,b,c,d,e,value') => {
  const text = `function source(req, values) { sink(${args}); } function sink(${formals}) {}`;
  const relations = buildCodeRelations(text, 'source.js');
  const source = createRiskSourceChunk(), sink = createRiskSinkChunk();
  source.codeRelations.callDetails = relations.callDetails.filter(detail => detail.callee === 'sink')
    .map(detail => ({ ...detail, targetChunkUid: sink.chunkUid }));
  sink.docmeta.callableParameters = relations.functionMeta.sink.callableParameters;
  sink.docmeta.paramNames = relations.functionMeta.sink.paramNames;
  return computeRiskScenario({ chunks: [source, sink], runtime: createRiskRuntime({ strictness: 'argAware',
    sourceRules: [{ id: 'source.req.body', patterns: [/req\.body/i] }] }) });
};
const tail = run('0,0,0,0,0,req.body');
assert.equal(tail.flowRows.length, 1, 'tainted sixth argument remains observable beyond display cap');
const unknown = run('...values, req.body');
assert.equal(unknown.flowRows.length, 0, 'unproved expansion cannot fabricate a fixed tainted parameter');
assert.ok(JSON.stringify(unknown.partialFlowRows).includes('incompleteArgumentEvidence'));
assert.ok(!JSON.stringify(unknown.partialFlowRows).includes('untaintedArgs'));
const complete = run('0,0,0,0,0,1');
assert.equal(complete.flowRows.length, 0);
assert.ok(JSON.stringify(complete.partialFlowRows).includes('untaintedArgs'), 'a complete examined negative stays distinct');
const capped = run(Array.from({ length: 40 }, (_, index) => index === 39 ? 'req.body' : '0').join(','));
assert.equal(capped.flowRows.length, 0);
assert.ok(JSON.stringify(capped.partialFlowRows).includes('incompleteArgumentEvidence'));
const rest = run('0,0,0,0,0,req.body', 'first,...values');
assert.equal(rest.flowRows.length, 1, 'rest binding retains the tainted delivered element without inventing another formal');
const prefix = run(`req.body,"${'x'.repeat(120)}"`);
assert.equal(prefix.flowRows.length, 1, 'independent positive prefix remains useful with incomplete sibling evidence');
assert.ok(JSON.stringify(prefix.partialFlowRows).includes('incompleteArgumentEvidence'));
console.log('risk argument evidence preserves sixth-slot/rest positives and explicit unknown/tail frontiers');
