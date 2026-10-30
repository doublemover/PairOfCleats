import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createJsonlLineFramer } from '../../../src/shared/artifact-io/json/line-framer.js';
import { scanJsonlBuffer } from '../../../src/shared/artifact-io/json/line-scan.js';

// Observe the real framing owner used by both real scanners; no parser, decoder,
// stream iteration or delimiter algorithm is replaced by the fixture wrapper.
const scanUrl = new URL('../../../src/shared/artifact-io/json/line-scan.js', import.meta.url).href;
const framerUrl = new URL('../../../src/shared/artifact-io/json/line-framer.js', import.meta.url).href;
const observations = []; globalThis.jsonlFragmentObservations = observations;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === scanUrl + '?framing-observer' && specifier === './line-framer.js') return { url: 'jsonl-framing:observer', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'jsonl-framing:observer') return { format: 'module', shortCircuit: true, source: `
      import {createJsonlLineFramer as create} from ${JSON.stringify(framerUrl)};
      export const createJsonlLineFramer=()=>{
        const frame=create(),dispose=frame.dispose;
        frame.dispose=()=>{const before=frame.getStats();dispose();
          globalThis.jsonlFragmentObservations.push({before,after:frame.getStats()});};
        return frame;
      };` };
    return next(url, context);
  }
});
const sourcePath = 'fragment-framing.jsonl';
const chunksOf = async function* (raw, size) {
  for (let offset = 0; offset < raw.length; offset += size) yield raw.subarray(offset, offset + size);
};
try {
  const { scanJsonlStream, parseJsonlStreamEntries } = await import(scanUrl + '?framing-observer');
  const scanners = [
    (source, options) => scanJsonlStream(source, { targetPath: sourcePath, ...options }),
    (source, options) => parseJsonlStreamEntries(source, { targetPath: sourcePath, ...options })
  ];
  const expected = [{ text: 'café 水 😀', id: 1 }, { id: 2 }, { final: '雪😀' }];
  const raw = Buffer.from('\r\n' + JSON.stringify(expected[0]) + '\r\n\n' + JSON.stringify(expected[1]) + '\n' + JSON.stringify(expected[2]));
  for (const scan of scanners) {
    for (let split = 1; split <= raw.length; split++) {
      const actual = [];
      const source = (async function* () { yield raw.subarray(0, split); yield Buffer.alloc(0); yield raw.subarray(split); })();
      const result = await scan(source, { maxBytes: raw.length, onEntry: row => actual.push(row) });
      assert.deepEqual(actual, expected); assert.deepEqual(result, { rows: 3, bytes: raw.length });
      const observation = observations.at(-1);
      assert.equal(observation.before.delimiterSearchCodeUnits, raw.toString('utf8').length);
      assert.equal(observation.after.pendingCodeUnits, 0); assert.equal(observation.after.pendingFragments, 0);
    }
    // Grow one complete or unterminated row well beyond a normal stream buffer.
    // Exact logical search work, rather than a machine-dependent latency bound,
    // exposes the former triangular prefix rescan at each explicit chunk size.
    for (const size of [200 * 1024, 1024 * 1024, 8 * 1024 * 1024, 16 * 1024 * 1024]) {
      for (const chunkSize of [4093, 64 * 1024]) {
        for (const terminated of [false, true]) {
          const text = 'x'.repeat(size), input = Buffer.from(JSON.stringify({ text }) + (terminated ? '\r\n{"id":2}\n' : ''));
          let rows = 0;
          const result = await scan(chunksOf(input, chunkSize), { maxBytes: input.length, onEntry: row => {
            if (++rows === 1) assert.equal(row.text, text); else assert.deepEqual(row, { id: 2 });
          } });
          assert.equal(result.rows, terminated ? 2 : 1); assert.equal(result.bytes, input.length);
          const work = observations.at(-1).before;
          assert.equal(work.delimiterSearchCodeUnits, input.length, 'each newly decoded ASCII code unit is searched once');
          assert.ok(work.joinedCodeUnits <= input.length, 'each fragmented row joins at most once');
          assert.ok(work.joins <= result.rows); assert.equal(observations.at(-1).after.pendingFragments, 0);
        }
      }
    }
    for (const malformed of ['\r\n{"ok":1}\n{broken}', '{"ok":1}\r\n\n{"missing":2}\n']) {
      const bytes = Buffer.from(malformed), options = { maxBytes: bytes.length, requiredKeys: ['ok'] };
      let expectedFailure;
      try { scanJsonlBuffer(bytes, sourcePath, options); } catch (error) { expectedFailure = error; }
      assert.ok(expectedFailure);
      await assert.rejects(scan(chunksOf(bytes, 1), { ...options, onEntry: () => {} }), error =>
        error.code === expectedFailure.code && error.message === expectedFailure.message);
      assert.equal(observations.at(-1).after.pendingFragments, 0);
    }
    const tooLarge = Buffer.from('{"id":1}\n');
    let callbacks = 0;
    await assert.rejects(scan(chunksOf(tooLarge, tooLarge.length), { maxBytes: tooLarge.length - 1,
      onEntry: () => { callbacks++; } }), { code: 'ERR_JSON_TOO_LARGE' });
    assert.equal(callbacks, 0); assert.equal(observations.at(-1).before.delimiterSearchCodeUnits, 0, 'byte admission precedes framing');

    for (const primary of [Object.freeze(new Error('callback failed')), undefined, null, false, 0, '']) {
      let closed = false, failure, failed = false;
      const source = (async function* () { try { yield Buffer.from('{"id":1}\n{"id":2}\n'); yield tooLarge; } finally { closed = true; } })();
      try { await scan(source, { maxBytes: 1000, onEntry: () => { throw primary; } }); }
      catch (error) { failed = true; failure = error; }
      assert.equal(failed, true); assert.equal(failure, primary); assert.equal(closed, true);
      assert.equal(observations.at(-1).after.pendingFragments, 0);
    }
    const controller = new AbortController(); let closed = false;
    const source = (async function* () { try { yield Buffer.from('{"text":"unfinished'); controller.abort(); yield Buffer.from('"}\n'); } finally { closed = true; } })();
    await assert.rejects(scan(source, { maxBytes: 1000, signal: controller.signal, onEntry: () => assert.fail('aborted row emitted') }), { name: 'AbortError' });
    assert.equal(closed, true); assert.equal(observations.at(-1).after.pendingFragments, 0);
  }
  let release, entered, pulls = 0, calls = 0;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const source = (async function* () { pulls++; yield Buffer.from('{"id":1}\n{"id":2}\n'); pulls++; yield Buffer.from('{"id":3}'); })();
  const pending = parseJsonlStreamEntries(source, { targetPath: sourcePath, maxBytes: 1000, onEntry: async () => {
    if (++calls === 1) { entered(); await gate; }
  } });
  await started; assert.equal(calls, 1); assert.equal(pulls, 1, 'held callback retains original stream backpressure');
  release(); assert.deepEqual(await pending, { rows: 3, bytes: 26 });
  assert.equal(calls, 3); assert.equal(pulls, 2);

  const frame = createJsonlLineFramer(); [...frame.push('unfinished')]; frame.dispose();
  assert.deepEqual({ units: frame.getStats().pendingCodeUnits, fragments: frame.getStats().pendingFragments }, { units: 0, fragments: 0 });
  assert.throws(() => [...frame.push('late')], /disposed/u); assert.throws(() => frame.finish(), /disposed/u);
} finally { hooks.deregister(); delete globalThis.jsonlFragmentObservations; }
console.log('Both JSONL scanners search only new fragments with exact UTF-8/line/error parity and original backpressure/cancellation ownership.');
