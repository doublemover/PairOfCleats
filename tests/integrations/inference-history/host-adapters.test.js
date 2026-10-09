import assert from 'node:assert/strict';
import { createHistoryHostBoundary } from '../../../src/integrations/inference-history/host-boundary.js';
import { createHistoryOwnerHttpHandler } from '../../../src/integrations/inference-history/owner-http.js';
import { createHistoryAgentBroker } from '../../../src/integrations/inference-history/agent-broker.js';
const origin='http://127.0.0.1:8123',context=Object.freeze({kind:'synthetic-context'}),transport=Object.freeze({kind:'synthetic-transport'});
let time=1000,channel='human',epoch='1',isolationEpoch='1',isolated=true,expired=false,revokeAfterRead=false;
const session=()=>({sessionId:'synthetic-session',principalId:'synthetic-owner',partition:'synthetic',channel,policyEpoch:epoch,
  requestContext:context,expiresAt:expired?999:10000,csrfToken:'synthetic-form-token'});
const boundary=createHistoryHostBoundary({now:()=>time,resolveSession:()=>session(),verifyIsolation:()=>({verified:true,mode:isolated?'separate_host':'same_user',
  auditSinkIsolated:isolated,humanChannelIsolated:isolated,policyEpoch:isolationEpoch})});
let pages=0,writes=0,audits=0,lastScope;
const console={
  async page(scope,options){pages++;lastScope=scope;assert.equal(options.csrfToken,'synthetic-form-token');if(revokeAfterRead)epoch='2';return '<!doctype html><p>synthetic owner page</p>';},
  async audit(scope){audits++;lastScope=scope;return {events:[{query:'synthetic query'}]};},
  async setPrivacy(scope){writes++;lastScope=scope;return {changed:true};}
};
const handle=createHistoryOwnerHttpHandler({console,boundary,origin});
const get=(path='/owner/history',headers={})=>new Request(origin+path,{headers});
const fields={recordRef:'a'.repeat(64),expectedGeneration:'b'.repeat(64),csrfToken:'synthetic-form-token',redactions:'["literal"]',annotation:'synthetic'};
const post=(overrides={},headers={},body)=>new Request(origin+'/owner/history/privacy',{method:'POST',
  headers:{origin,'content-type':'application/x-www-form-urlencoded',...headers},body:body??new URLSearchParams({...fields,...overrides}).toString()});
let response=await handle(get('/owner/history?top=2&offset=1'),transport);
assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');
assert.equal(lastScope.requestContext,context);assert.equal(lastScope.partition,'synthetic');
assert.equal(lastScope.top,2);assert.equal(lastScope.offset,1);
assert.equal((await handle(get('/owner/history/audit'),transport)).status,200);assert.equal(audits,1);
assert.equal((await handle(post(),transport)).status,200);assert.equal(writes,1);
assert.deepEqual(lastScope.redactions,['literal']);assert.equal(lastScope.excluded,false);
assert.equal((await handle(get('/owner/history/privacy'),transport)).status,405);
assert.equal((await handle(get('/owner/history?partition=other'),transport)).status,400);
assert.equal((await handle(get('/owner/history?top=1&top=2'),transport)).status,400);
assert.equal((await handle(get('/owner/history?top=101'),transport)).status,400);
assert.equal((await handle(get('/missing'),transport)).status,404);
assert.equal((await handle(get('/owner/history',{origin:'http://outside.invalid'}),transport)).status,403);
time=NaN;assert.equal((await handle(get(),transport)).status,403);time=1000;
assert.equal((await handle(new Request('http://outside.invalid/owner/history'),transport)).status,403);
assert.equal((await handle(post({}, {origin:'http://outside.invalid'}),transport)).status,403);
assert.equal((await handle(post({csrfToken:'wrong'}),transport)).status,403);
assert.equal((await handle(post({partition:'forged'}),transport)).status,400);
assert.equal((await handle(post({}, {},new URLSearchParams(fields).toString()+'&recordRef=duplicate'),transport)).status,400);
assert.equal((await handle(post({}, {},new URLSearchParams(fields).toString()+'&annotation=%E0'),transport)).status,400);
assert.equal((await handle(post({}, {'content-type':'application/json'}),transport)).status,415);
assert.equal((await handle(post({}, {'content-length':'65537'}),transport)).status,413);
assert.equal((await handle(post({}, {},'annotation='+ 'x'.repeat(65537)),transport)).status,413);
assert.equal(writes,1);
isolated=false;const before=pages;
assert.equal((await handle(get(),transport)).status,503);assert.equal(pages,before);isolated=true;
expired=true;assert.equal((await handle(get(),transport)).status,403);expired=false;
channel='agent';assert.equal((await handle(get(),transport)).status,403);channel='human';
revokeAfterRead=true;response=await handle(get(),transport);
assert.equal(response.status,403);assert.ok(!(await response.text()).includes('synthetic owner page'));revokeAfterRead=false;epoch='1';
const throwing=createHistoryOwnerHttpHandler({console,boundary:createHistoryHostBoundary({resolveSession:()=>{throw new Error('secret host detail');},
  verifyIsolation:()=>({verified:true,mode:'separate_host',auditSinkIsolated:true,humanChannelIsolated:true,policyEpoch:'1'})}),origin});
response=await throwing(get(),transport);assert.equal(response.status,403);assert.ok(!(await response.text()).includes('secret host detail'));
assert.throws(()=>createHistoryHostBoundary({resolveSession:()=>session()}));
const bound=await boundary.bind(transport,'human');isolationEpoch='2';await assert.rejects(bound.recheck(),{code:'ERR_INFERENCE_HISTORY_UNAVAILABLE'});isolationEpoch='1';
const expiring=await boundary.bind(transport,'human');time=10001;await assert.rejects(expiring.recheck(),{code:'ERR_INFERENCE_HISTORY_DENIED'});time=1000;
// Revocation while reading the body is checked before a mutation can run.
epoch='1';let release;
const delayed=new ReadableStream({start(controller){release=()=>{epoch='2';controller.enqueue(new TextEncoder().encode(new URLSearchParams(fields).toString()));controller.close();};}});
const pending=handle(new Request(origin+'/owner/history/privacy',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:delayed,duplex:'half'}),transport);
await new Promise(resolve=>setImmediate(resolve));release();assert.equal((await pending).status,403);assert.equal(writes,1);epoch='1';
const abort=new AbortController(),abortTimer=setTimeout(()=>abort.abort(),10);
const hanging=new ReadableStream({start(){}});
response=await handle(new Request(origin+'/owner/history/privacy',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:hanging,duplex:'half',signal:abort.signal}),transport);
clearTimeout(abortTimer);assert.equal(response.status,413);assert.equal(writes,1);
// The broker accepts only agent commands and keeps authentication out of its payload.
const broker=createHistoryAgentBroker({service:{},boundary});channel='agent';
let packet=await broker(JSON.stringify({command:'help'}),transport);
assert.equal(packet.ok,true);assert.equal(packet.packet.version,'history-agent.v1');
assert.equal((await broker(JSON.stringify({command:'audit'}),transport)).error.code,'INVALID_REQUEST');
assert.equal((await broker(JSON.stringify({command:'help',principalId:'forged'}),transport)).error.code,'INVALID_REQUEST');
assert.equal((await broker('x'.repeat(16385),transport)).error.code,'INPUT_BUDGET');
channel='human';assert.equal((await broker(JSON.stringify({command:'help'}),transport)).error.code,'ERR_INFERENCE_HISTORY_DENIED');
channel='agent';isolated=false;assert.equal((await broker(JSON.stringify({command:'help'}),transport)).error.code,'ERR_INFERENCE_HISTORY_UNAVAILABLE');
process.stdout.write('Synthetic owner HTTP/session/isolation and agent broker contracts passed.\n');
