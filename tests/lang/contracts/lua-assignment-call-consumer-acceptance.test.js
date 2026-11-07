import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareRegisteredLanguage } from '../../helpers/registered-language-acceptance.js';
applyTestEnv();
const assigned = 'M.make = function(value)\n return value\nend';
for (const text of [assigned, assigned+'\nfunction plain() return 1 end\n', 'function plain() return 1 end\n'+assigned]) {
  const fixture = await prepareRegisteredLanguage({text,ext:'.lua'});
  const matches=fixture.chunks.filter(chunk=>chunk.name==='M.make');
  assert.equal(matches.length,1);
  assert.equal(text.slice(matches[0].start,matches[0].end),assigned);
  assert.equal(matches[0].meta.signature,'M.make = function(value)');
  assert.deepEqual(matches[0].meta.params,['value']);
  assert.deepEqual(fixture.relations.calls,[]);
  assert.ok(fixture.payloads.find(row=>row.name==='M.make').fieldTokens.signature.includes('value'));
}
const text = [
  'local local_make = function(value) return value end',
  'function idle(value) return value end',
  'function caller() return M.make(1) end',
  'function recur(n) return recur(n-1) end',
  'function outer() local function inner() return leaf() end end',
  'function invoked() local function inner() return leaf() end inner() end',
  'function M:method(value) return target(value) end',
  'function strings() local value="phantom()" -- comment_call()\n return value end',
  'many, targets = function(parameter) return ambiguous() end, 1',
  'table_data = { field = function(parameter) return table_call() end }',
  'consume(function(parameter) return anonymous_call() end)', ''
].join('\n');
const fixture=await prepareRegisteredLanguage({text,ext:'.lua'});
assert.ok(text.slice(fixture.chunks.find(chunk=>chunk.name==='local_make').start,
  fixture.chunks.find(chunk=>chunk.name==='local_make').end).startsWith('local local_make'));
assert.ok(fixture.chunks.every(chunk=>!['parameter','ambiguous','table_call','anonymous_call'].includes(chunk.name)));
assert.ok(fixture.chunks.some(chunk=>chunk.meta.luaDeclarationCoverage?.state==='partial'));
const edges=fixture.relations.calls.map(edge=>edge.join(' -> ')).sort();
assert.deepEqual(edges,['M.method -> target','caller -> M.make','inner -> leaf','invoked -> inner','recur -> recur'].sort());
for(const [index,chunk] of fixture.chunks.entries()) {
  const calls=fixture.projected[index].calls || [];
  if(['idle','strings','outer','local_make'].includes(chunk.name)) assert.deepEqual(calls,[],chunk.name);
  assert.ok(chunk.chunkUid);
}
console.log('Lua assignment source/signature ownership and exact registered call projections passed.');
