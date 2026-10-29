import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const actual = new URL('../../../src/index/build/postings/token-field.js', import.meta.url).href;
const controller = new AbortController();
let release, entered = false, settled = false, calls = 0;
const gate = new Promise(resolve => { release = resolve; });
globalThis.__postingsCallerOwner = { signal: controller.signal, requestYield: event => {
  calls++; assert.ok(event.units <= 2);
  if (!entered) { entered = true; controller.abort(); return gate; }
  assert.fail('a later materialization unit was admitted after cancellation');
} };
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/src/index/build/postings/index.js') && specifier === './token-field.js') {
    return { url: 'postings-caller:token-field', shortCircuit: true };
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 'postings-caller:token-field') return { format: 'module', shortCircuit: true, source:
    'import {buildTokenAndFieldPostings as actual} from ' + JSON.stringify(actual) + ';'
    + 'export const buildTokenAndFieldPostings=options=>{if(options.signal!==globalThis.__postingsCallerOwner.signal)throw new Error("Build signal handoff lost");'
    + 'return actual({...options,workBatchSize:2,requestYield:globalThis.__postingsCallerOwner.requestYield});};' };
  return next(url, context);
} });
try {
  const { buildPostings } = await import('../../../src/index/build/postings/index.js');
  const tokens = new Map([['a', [[0, 1]]], ['b', [[0, 2]]], ['c', [[0, 1]]]]);
  const work = buildPostings({ chunks: [{ id: 0 }], df: new Map(), tokenPostings: tokens, docLengths: [4],
    fieldPostings: {}, fieldDocLengths: {}, phrasePost: new Map(), triPost: new Map(), embeddingsEnabled: false,
    abortSignal: controller.signal, log() {} }).finally(() => { settled = true; });
  const rejected = assert.rejects(work, { name: 'AbortError' });
  for (let step = 0; step < 100 && !entered; step++) await Promise.resolve();
  assert.equal(entered, true); assert.equal(settled, false, 'the real Stage2 producer retains its child wait after cancellation');
  assert.equal(tokens.size, 3, 'a vocabulary-phase cancellation has not consumed source maps');
  release(); await rejected;
  assert.equal(calls, 1); assert.equal(settled, true);
} finally { release(); hook.deregister(); delete globalThis.__postingsCallerOwner; }
console.log('The actual postings caller forwards cancellation and retains ownership until token work settles.');
