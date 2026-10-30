import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { runSampledBench } from '../../../tools/bench/micro/utils.js';

const runner = new URL('../../../tools/bench/micro/regex-runner.js', import.meta.url).href;
const safeRegex = new URL('../../../src/shared/safe-regex.js', import.meta.url).href;
const jsBackend = new URL('../../../src/shared/safe-regex/backends/re2js.js', import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(runner) && specifier === '../../../src/shared/safe-regex.js') {
    return { url: safeRegex + '?' + context.parentURL.split('?')[1], shortCircuit: true };
  }
  if (context.parentURL?.startsWith(safeRegex + '?') && specifier.endsWith('/backends/re2.js')) {
    return { url: 'regex-native-fixture:' + context.parentURL.split('?')[1], shortCircuit: true };
  }
  if (context.parentURL?.startsWith(safeRegex + '?') && specifier.endsWith('/backends/re2js.js')) {
    return { url: 'regex-js-instrumented:' + context.parentURL.split('?')[1], shortCircuit: true };
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (url.startsWith('regex-native-fixture:')) return { format: 'module', shortCircuit: true, source: `
    export const createRe2Backend=()=>({name:'re2',available:globalThis.regexEngineFixture.native,
      compile({source,flags}){globalThis.regexEngineFixture.re2.compile++;return new RegExp(source,flags);},
      exec(regex,text,start,isGlobal){globalThis.regexEngineFixture.re2.exec++;regex.lastIndex=isGlobal?start:0;
        const match=regex.exec(text);return match?{match,nextIndex:isGlobal?regex.lastIndex:0}:null;}});` };
  if (url.startsWith('regex-js-instrumented:')) return { format: 'module', shortCircuit: true, source: `
    import {createRe2jsBackend as real,checkProgramSize} from ${JSON.stringify(jsBackend)};export {checkProgramSize};
    export const createRe2jsBackend=()=>{const backend=real();return {...backend,
      compile(options){globalThis.regexEngineFixture.re2js.compile++;return backend.compile(options);},
      exec(...args){globalThis.regexEngineFixture.re2js.exec++;return backend.exec(...args);}};};` };
  return next(url, context);
} });
const sample = async (operation, { iterations, samples, warmup }) => {
  let now = 0n;
  return runSampledBench(operation, { iterations, samples, warmup }, { nowNs: () => {
    const current = now; now += 1000000n; return current;
  } });
};
const packageIdentity = name => ({ name, version: 'explicit-fixture' });
const input = { pattern: '(hit)\\s+\\w+', flags: 'g', input: 'hit first hit second', iterations: 3, warmup: 2, samples: 99 };
let runRegexBenchmark;
try {
  for (const native of [true, false]) {
    const state = { native, re2: { compile: 0, exec: 0 }, re2js: { compile: 0, exec: 0 } };
    globalThis.regexEngineFixture = state;
    ({ runRegexBenchmark } = await import(runner + '?native=' + Number(native)));
    const result = await runRegexBenchmark(input, { native: () => ({ available: native, reason: 'explicit-fixture-unavailable' }), packageIdentity, sample });
    assert.equal(result.comparison, 'same-safe-regex-public-wrapper');
    assert.equal(result.operation, 'reset-lastIndex-to-zero-then-test');
    assert.equal(result.samples, 3, 'sample count cannot make the sampler run more than three measured operations');
    assert.equal(result.engines.re2js.requestedEngine, 're2js'); assert.equal(result.engines.re2js.effectiveEngine, 're2js');
    assert.equal(state.re2js.compile, 1); assert.equal(state.re2js.exec, 7, 'real RE2JS receives two parity operations plus exact warmup/measurement work');
    assert.equal(result.engines.re2js.measuredOperations, 3); assert.equal(result.engines.re2js.warmupOperations, 2);
    assert.equal(result.engines.re2js.matching.matched, true);
    assert.deepEqual(result.engines.re2js.rawSampleDurationsMs, [1, 1, 1]);
    assert.equal(result.runtime.node, process.version);
    if (native) {
      // A named RegExp-backed adapter supplies optional-native dispatch control;
      // only the JS arm uses real RE2JS. This is not native speed qualification.
      assert.equal(state.re2.compile, 1); assert.equal(state.re2.exec, 7);
      assert.equal(result.engines.re2.effectiveEngine, 're2');
      assert.equal(result.engines.re2.matching.digest, result.engines.re2js.matching.digest);
    } else {
      assert.equal(state.re2.compile, 0); assert.equal(state.re2.exec, 0);
      assert.equal(result.engines.re2.available, false); assert.equal(result.engines.re2.effectiveEngine, null);
    }
    const nonmatch = await runRegexBenchmark({ ...input, input: 'no match', iterations: 2, samples: 20, warmup: 0 },
      { native: () => ({ available: native }), packageIdentity, sample });
    assert.equal(nonmatch.engines.re2js.matching.matched, false);
    assert.equal(nonmatch.engines.re2js.measuredOperations, 2); assert.equal(nonmatch.samples, 2);
  }
  let timed = 0;
  await assert.rejects(runRegexBenchmark(input, { native: () => ({ available: true }), packageIdentity,
    compile: () => ({ engine: 're2', flags: 'g' }), sample: async () => { timed++; } }), { code: 'ERR_BENCH_REGEX_ENGINE' });
  assert.equal(timed, 0, 'effective-engine substitution must fail before timing begins');
  const compile = (pattern, flags, { engine }) => { const regex = new RegExp(pattern, flags); return {
    engine, flags, lastIndex: 0, exec(text) { regex.lastIndex = 0; return engine === 're2' ? null : regex.exec(text); }, test() { return true; }
  }; };
  await assert.rejects(runRegexBenchmark(input, { native: () => ({ available: true }), packageIdentity, compile,
    sample: async () => { timed++; } }), { code: 'ERR_BENCH_REGEX_PARITY' });
  assert.equal(timed, 0, 'matching-result disagreement cannot publish a timing contrast');
  await assert.rejects(runRegexBenchmark({ ...input, iterations: Infinity }), RangeError);
  await assert.rejects(runRegexBenchmark({ ...input, flags: 'u' }), TypeError);
} finally { hooks.deregister(); delete globalThis.regexEngineFixture; }
console.log('regex benchmark explicitly selects actual wrapper engines, matching/state policy and exact measured work');
