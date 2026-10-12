import assert from 'node:assert/strict';
import { createCompileController } from '../../../src/map/workspace/reladraw.js';
import { createRequestController, readBoundedJson } from '../../../src/map/workspace/request.js';
class FakeWorker {
  static instances = [];
  constructor() { FakeWorker.instances.push(this); }
  postMessage(data) { this.request = data; }
  terminate() { this.terminated = true; }
}
const compiler = createCompileController({ WorkerClass: FakeWorker, timeoutMs: 15 });
const first = compiler.compile('node a').catch(error => error.name);
const second = compiler.compile('node b');
assert.equal(await first,'AbortError'); assert.equal(FakeWorker.instances[0].terminated,true);
FakeWorker.instances[0].onmessage({data:{svg:'stale'}});
FakeWorker.instances[1].onmessage({data:{svg:'new'}});
assert.equal((await second).svg,'new'); assert.equal(FakeWorker.instances[1].terminated,true);
await assert.rejects(compiler.compile('node c'), /deadline/);
await assert.rejects(compiler.compile('x'.repeat(262145)), /256 KiB/);
const pending = [];
const requests = createRequestController({ fetchFn: (_,options) => new Promise(resolve => pending.push({resolve,options})) });
const old = requests.request('search',{}).catch(error=>error.name); const next = requests.request('search',{});
assert.equal(pending[0].options.signal.aborted,true);
pending[1].resolve(new Response(JSON.stringify({hits:[]}))); await next;
pending[0].resolve(new Response(JSON.stringify({hits:[1]}))); assert.equal(await old,'AbortError');
await assert.rejects(requests.request('enrichment',{action:'drain'}), /only reads/);
await assert.rejects(requests.request('https://example.com',{}), /Unsupported/);
const mismatch = createRequestController({fetchFn:async()=>new Response(JSON.stringify({generation:{baseBuildId:'other',semanticRevision:0}}))});
await assert.rejects(mismatch.request('detail',{}, {expectedGeneration:{baseBuildId:'expected',semanticRevision:0}}), /Generation mismatch/);
await assert.rejects(readBoundedJson(new Response('x'.repeat(100)),10), /admission/);
console.log('Repeated compile, replacement, timeout, stale replies, generation mismatch and read-only action boundaries passed.');
