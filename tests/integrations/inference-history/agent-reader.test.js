import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createInferenceHistoryService as createService } from '../../../src/integrations/inference-history/service.js';
import { createHistoryAgentReader, renderHistoryAgentSummary, resolveHistoryCitation } from '../../../src/integrations/inference-history/agent-reader.js';
import { historyAgentHelp, validateHistoryAgentRequest } from '../../../src/integrations/inference-history/agent-contract.js';
const createInferenceHistoryService=options=>createService({audit:()=>({persisted:true}),...options});

// Entirely synthetic source; retained task artifacts, no personal archive reads.
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-agent-usability-')));
await fs.mkdir(root, { recursive: true });
const source = path.join(root, 'synthetic.json');
const vault = path.join(root, 'synthetic-vault');
await fs.mkdir(vault, { recursive: true, mode: 0o700 });
const node = (id, parent, children, role, text, date) => ({ id, parent, children,
  message: { id, author: { role }, create_time: Date.parse(date) / 1000,
    content: { content_type: 'text', parts: [text] } } });
const conversation = { id: 'synthetic-agent-trial', title: 'Synthetic audio tooling', current_node: 'd', mapping: {
  root: { id: 'root', parent: null, children: ['a'], message: null },
  a: node('a', 'root', ['b'], 'user', 'Cobalt MIDI keyboard must have editable controls.', '2026-09-01T00:00:00.000Z'),
  b: node('b', 'a', ['c'], 'assistant', 'Try Cobalt MIDI routing.', '2026-09-02T00:00:00.000Z'),
  c: node('c', 'b', ['d'], 'user', 'Cobalt MIDI should preserve velocity and timing.', '2026-10-07T23:59:59.999Z'),
  d: node('d', 'c', [], 'user', 'Cobalt MIDI needs an undo button. ' + 'Long synthetic text '.repeat(100), '2026-10-08T00:00:00.000Z')
} };
await fs.writeFile(source, JSON.stringify([conversation]));
const service = createInferenceHistoryService({
  vaultRoot: vault,
  verifyPrivateVault: () => true,
  resolveAccess: ({ requestContext, partition }) => requestContext === 'synthetic-owner' && partition === 'synthetic'
    ? { principalId: 'synthetic-owner', tenantId: 'synthetic', ownerType: 'individual',
      ownerId: 'synthetic-owner', sourceScope: 'synthetic-export', policyEpoch: '1', allowed: true } : null,
  resolveImportSource: () => ({ path: source, policyEpoch: '1' })
});
await service.importExport({ requestContext: 'synthetic-owner', partition: 'synthetic', source: 'synthetic' });
const reader = createHistoryAgentReader({ service, requestContext: 'synthetic-owner', partition: 'synthetic' });
assert.equal(historyAgentHelp({ full: true }).version, 'history-agent.v1');
const request = { query: 'Cobalt MIDI', role: 'user', top: 1, snippetChars: 80, dateFrom: '2026-09-01', dateTo: '2026-10-07' };
const first = await reader.execute('search', request);
assert.equal(first.ok, true);
assert.equal(first.page.totalMatches, 2);
assert.equal(first.evidence.length, 1);
assert.equal(first.evidence[0].role, 'user');
assert.ok(first.evidence[0].createdAt.utc);
assert.match(first.evidence[0].citation, /^h-[a-f0-9]{20}$/);
assert.deepEqual(first.page.next.request, { ...first.request, offset: 1, expectedGeneration: first.index.generationRef });
const second = await reader.execute(first.page.next.command, first.page.next.request);
assert.equal(second.evidence.length, 1);
assert.notEqual(second.evidence[0].sourceRef, first.evidence[0].sourceRef);
assert.equal(second.page.next, null);
const contextAction = first.evidence[0].actions.context;
const context = await reader.execute(contextAction.command, contextAction.request);
assert.equal(context.ok, true);
assert.ok(context.evidence.some(value => value.role === 'assistant'));
assert.ok(context.evidence.some(value => value.anchor));
assert.equal(context.evidence.find(value => value.sourceRef === first.evidence[0].sourceRef).citation, first.evidence[0].citation);
const provenance = await reader.execute('references', first.evidence[0].actions.references.request);
assert.equal(provenance.ok, true);
assert.equal(provenance.page.totalReferences, 1);
assert.equal(provenance.evidence[0].occurrences[0].member, 'conversations.json');
const exact = await reader.execute('original', first.evidence[0].actions.original.request);
assert.equal(exact.result.raw.id, conversation.id);
assert.equal((await reader.execute('search', { query: 'Cobalt missingword', match: 'strict' })).evidence.length, 0);
for (const [command, input] of [
  ['search', { query: '!!!' }], ['search', { query: 'Cobalt', top: 0 }],
  ['search', { query: 'Cobalt', role: 'system' }], ['search', { query: 'Cobalt', dateFrom: '2026-02-30' }],
  ['search', { query: 'Cobalt', dateFrom: '2026-10-07', dateTo: '2026-09-01' }],
  ['context', { sourceRef: first.evidence[0].citation, snapshotRef: first.evidence[0].snapshotRef }],
  ['search', { query: 'Cobalt', repo: 'not-authority' }]
]) {
  const result = await reader.execute(command, input);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_REQUEST');
  assert.ok(result.error.field);
  assert.ok(result.error.hint);
}
const denied = createHistoryAgentReader({ service, requestContext: 'foreign', partition: 'synthetic' });
assert.equal((await denied.execute('search', { query: 'Cobalt' })).error.code, 'ERR_INFERENCE_HISTORY_DENIED');
const fault = createHistoryAgentReader({ service: { search: () => { const error = new Error('PRIVATE secret');
  error.code = 'INVALID_REQUEST'; error.hint = 'PRIVATE secret'; throw error; } }, requestContext: 'synthetic-owner', partition: 'synthetic' });
assert.ok(!JSON.stringify(await fault.execute('search', { query: 'Cobalt' })).includes('PRIVATE'));
const budget = await reader.execute('original', first.evidence[0].actions.original.request, { maxOutputBytes: 4096 });
assert.equal(budget.error.code, 'OUTPUT_BUDGET');
assert.ok(!Object.hasOwn(budget, 'evidence'));
assert.ok(Buffer.byteLength(JSON.stringify(budget)) < 4096);
const long = await reader.execute('search', { query: 'undo', snippetChars: 80 });
assert.equal(long.evidence[0].snippet.truncated, true);
assert.match(renderHistoryAgentSummary(long), /text truncated/);
assert.equal(validateHistoryAgentRequest('search', { query: 'Cobalt' }).top, 5);
assert.deepEqual(request, { query: 'Cobalt MIDI', role: 'user', top: 1, snippetChars: 80, dateFrom: '2026-09-01', dateTo: '2026-10-07' });
console.log('archive agent reader synthetic usability tests passed');

const auto = await reader.execute('search', { query: 'Cobalt unfamiliar', role: 'user', dateTo: '2026-10-07' });
assert.equal(auto.semantics.relaxed, true);
assert.equal(auto.evidence.length, 2);
assert.ok(auto.evidence.every(row => row.role === 'user' && row.createdAt.utc <= '2026-10-07T23:59:59.999Z'));
const phrase = await reader.execute('search', { query: '"Cobalt MIDI" unfamiliar -undo', role: 'user' });
assert.equal(phrase.semantics.relaxed, true);
assert.equal(phrase.evidence.length, 2);
assert.ok(phrase.evidence.every(row => !row.text.includes('undo')));
assert.equal((await reader.execute('search', { query: '"MIDI Cobalt" unfamiliar', role: 'user' })).evidence.length, 0);
assert.equal((await reader.execute('search', { query: 'Cobalt -Cobalt' })).evidence.length, 0);
const noIndexReader = createHistoryAgentReader({ service: { search: async () => ({ hits: [], coverage: { imports: 0, complete: false }, complete: true, totalMatches: 0 }) }, partition: 'synthetic' });
assert.equal((await noIndexReader.execute('search', { query: 'missing' })).diagnostics.state, 'no_imported_index');

const resolved = resolveHistoryCitation(first, first.evidence[0].citation);
assert.deepEqual(resolved, first.evidence[0].actions.context);
resolved.request.sourceRef = 'changed';
assert.notEqual(first.evidence[0].actions.context.request.sourceRef, 'changed');
assert.throws(() => resolveHistoryCitation(first, 'missing'), /missing/);
assert.equal((await reader.execute('search', { query: '"unbalanced' })).error.field, 'query');
assert.equal((await reader.execute('search', { query: 'Cobalt', match: 'auto', offset: 100 })).diagnostics.state, 'page_exhausted');
assert.equal((await reader.execute('search', { query: 'Cobalt', match: 'auto', offset: 100 })).semantics.relaxed, false);

assert.equal(first.evidence[0].span.surface, 'redacted_projected_text');
assert.equal(first.evidence[0].span.end - first.evidence[0].span.start, first.evidence[0].text.length);

const oversized = await reader.execute('x'.repeat(100000), {});
assert.ok(Buffer.byteLength(JSON.stringify(oversized)) < 4096);
const mutableHelp = reader.help({full:true}); mutableHelp.requests.search.properties.top.default=99;
assert.equal(reader.help({full:true}).requests.search.properties.top.default,5);

const timeline = await reader.execute('timeline', { ...contextAction.request, role:'user', order:'newest', dateTo:'2026-10-07', top:1 });
assert.equal(timeline.evidence[0].createdAt.utc,'2026-10-07T23:59:59.999Z');
assert.equal(timeline.evidence[0].role,'user');
assert.ok(timeline.page.next);
const originalGeneration = first.index.generationRef;
const repeatImport = await service.importExport({requestContext:'synthetic-owner',partition:'synthetic',source:'synthetic'});
assert.equal(repeatImport.index.generationRef,originalGeneration);
conversation.mapping.c.message.content.parts = ['Actually, Cobalt MIDI should use fixed velocity instead.'];
await fs.writeFile(source,JSON.stringify([conversation]));
const updated = await service.importExport({requestContext:'synthetic-owner',partition:'synthetic',source:'synthetic'});
assert.equal(updated.index.generation,first.index.generation+1);
assert.notEqual(updated.index.generationRef,originalGeneration);
assert.equal((await reader.execute(first.page.next.command,first.page.next.request)).error.code,'ERR_INFERENCE_HISTORY_STALE');
const fresh = await reader.execute('search',{query:'fixed velocity',role:'user'});
const correction = await reader.execute('timeline',{...fresh.evidence[0].actions.timeline.request,role:'user',dateTo:'2026-10-07'});
assert.equal(correction.evidence[0].signals.correctionLanguage,true);
assert.equal(correction.evidence[0].signals.meaning,'text_signal_only_acceptance_not_inferred');
assert.equal(fresh.index.exportFreshness,'unknown');

const {mergeHistoryContexts} = await import('../../../src/integrations/inference-history/context-bundle.js');
const merged = mergeHistoryContexts([context,context]);
assert.equal(merged.totalUniqueMessages,context.evidence.length);
assert.equal(merged.evidence.filter(row=>row.anchor).length,1);
assert.equal(mergeHistoryContexts([context],{maxMessages:1}).truncated,true);
assert.throws(()=>mergeHistoryContexts([context,correction]),/generations/);

const {createLocalHistorySemanticAdapter} = await import('../../../src/integrations/inference-history/semantic-adapter.js');
const authoritative = await service.search({requestContext:'synthetic-owner',partition:'synthetic',query:'Cobalt',role:'user',top:10});
const refs=authoritative.hits.map(row=>({sourceRef:row.sourceRef,snapshotRef:row.snapshotRef,text:'PROVIDER text is not evidence'}));
const provider=createLocalHistorySemanticAdapter({
  modelId:'synthetic-test-vector',modelVersion:'1',dimensions:2,indexGenerationRef:authoritative.index.generationRef,
  encodeQuery:async()=>[1,0],searchIndex:async()=>({complete:true,candidates:refs}),
  rerank:async(_query,candidates)=>candidates.map(row=>({sourceRef:row.sourceRef,snapshotRef:row.snapshotRef})).reverse()
});
const hybridService=createInferenceHistoryService({
  vaultRoot:vault,verifyPrivateVault:()=>true,semantic:provider,
  resolveAccess:({requestContext,partition})=>requestContext==='synthetic-owner' && partition==='synthetic'
    ? {principalId:'synthetic-owner',tenantId:'synthetic',ownerType:'individual',ownerId:'synthetic-owner',sourceScope:'synthetic-export',policyEpoch:'1',allowed:true}:null
});
const hybridReader=createHistoryAgentReader({service:hybridService,requestContext:'synthetic-owner',partition:'synthetic'});
const paraphrase=await hybridReader.execute('search',{query:'sequencer transport precision',role:'user',dateTo:'2026-10-07',mode:'semantic'});
assert.equal(paraphrase.ok,true);
assert.ok(paraphrase.evidence.length>0);
assert.ok(paraphrase.evidence.every(row=>row.role==='user' && !row.text.includes('PROVIDER')));
assert.equal(paraphrase.semantic.modelId,'synthetic-test-vector');
assert.equal(paraphrase.semantics.semanticMatching,true);
const hardPhrase=await hybridReader.execute('search',{query:'"not in the source"',mode:'semantic'});
assert.equal(hardPhrase.evidence.length,0);
const negative=await hybridReader.execute('search',{query:'transport -Cobalt',mode:'semantic'});
assert.equal(negative.evidence.length,0);
const reranked=await hybridReader.execute('search',{query:'Cobalt',mode:'hybrid',rerank:true});
assert.equal(reranked.semantic.reranked,true);
assert.equal((await reader.execute('search',{query:'Cobalt',mode:'semantic'})).error.code,'ERR_INFERENCE_HISTORY_UNAVAILABLE');
const foreignSemantic=createHistoryAgentReader({service:hybridService,requestContext:'foreign',partition:'synthetic'});
assert.equal((await foreignSemantic.execute('search',{query:'Cobalt',mode:'semantic'})).error.code,'ERR_INFERENCE_HISTORY_DENIED');
