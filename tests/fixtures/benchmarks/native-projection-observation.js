import assert from 'node:assert/strict';
import { buildTreeSitterChunks } from '../../../src/lang/tree-sitter.js';
import { buildCssChunks } from '../../../src/lang/css.js';
import { buildLuaChunks } from '../../../src/lang/lua.js';
import { getNativeTreeSitterParser } from '../../../src/lang/tree-sitter/native-runtime.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

export const highBudget = language => language === 'scala'
  ? { maxAstNodes: 100000, maxAstStack: 100000, maxChunkNodes: 1000 }
  : { maxAstNodes: 200000, maxAstStack: 200000, maxChunkNodes: 5000 };
export const nativeOptions = (language, { useQueries = false, budget = highBudget(language), cache = false, cacheRoot = null, key = null } = {}) => ({
  treeSitter: { enabled: true, strict: true, adaptive: false, useQueries, chunkCache: cache,
    cachePersistent: cache, cachePersistentDir: cacheRoot, cacheKey: key, ...budget },
  astDataflowEnabled: false, controlFlowEnabled: false
});
export const nativeBuild = (language, text, options) => language === 'scala'
  ? buildTreeSitterChunks({ text, languageId: language, ext: '.scala', options })
  : (language === 'css' ? buildCssChunks : buildLuaChunks)(text, options);
export const metricDelta = before => Object.fromEntries(Object.entries(treeSitterState.metrics)
  .filter(([key, value]) => typeof value === 'number')
  .map(([key, value]) => [key, value - (before[key] || 0)]));

export const cleanSamples = async (operation, validate, { iterations = 16, prepare = null } = {}) => {
  const samples = []; let result;
  for (let index = 0; index < iterations; index++) {
    await prepare?.();
    const cpu = process.threadCpuUsage(), at = performance.now();
    result = await operation();
    const wallMs = performance.now() - at, used = process.threadCpuUsage(cpu);
    samples.push({ wallMs, cpu: used });
    validate(result);
  }
  return { samples, iterations, scope: 'uninstrumented entrypoint;thread CPU and awaited wall;setup/assertions/hashes excluded', result };
};

/** Separate original-native descriptor/phase pass. No native tree/node escapes. */
export const observeNative = async (language, operation) => {
  const parser = getNativeTreeSitterParser(language); assert.ok(parser);
  const first = parser.parse(language === 'css' ? '.probe { color: red; }' : language === 'lua'
    ? 'function probe() return 1 end' : 'def probe(): Int = 1');
  let node;
  try { node = first.rootNode; assert.equal(node.hasError, false); }
  finally { first.delete?.(); parser.reset?.(); }
  const restore = [], reads = {}, parse = [], resets = [];
  for (const key of ['namedChild', 'namedChildCount', 'child', 'childCount', 'childForFieldName', 'childrenForFieldName', 'parent']) {
    let prototype = Object.getPrototypeOf(node), descriptor;
    while (prototype && !(descriptor = Object.getOwnPropertyDescriptor(prototype, key))) prototype = Object.getPrototypeOf(prototype);
    assert.ok(descriptor); assert.equal(descriptor.configurable, true); reads[key] = 0;
    const replacement = typeof descriptor.value === 'function' ? { ...descriptor, value: function(...args) {
      reads[key]++; return Reflect.apply(descriptor.value, this, args);
    } } : { ...descriptor, get: function() { reads[key]++; return Reflect.apply(descriptor.get, this, []); } };
    Object.defineProperty(prototype, key, replacement); restore.push(() => Object.defineProperty(prototype, key, descriptor));
  }
  const originalParse = parser.parse, originalReset = parser.reset;
  parser.parse = function(...args) {
    const cpu = process.threadCpuUsage(), at = performance.now();
    const tree = Reflect.apply(originalParse, this, args);
    parse.push({ wallMs: performance.now() - at, cpu: process.threadCpuUsage(cpu) }); return tree;
  };
  parser.reset = function(...args) {
    const at = performance.now(); const result = Reflect.apply(originalReset, this, args);
    resets.push(performance.now() - at); return result;
  };
  restore.push(() => { parser.parse = originalParse; parser.reset = originalReset; });
  const before = { ...treeSitterState.metrics }, cpu = process.threadCpuUsage(), at = performance.now();
  let failed = false, primary;
  try {
    const result = await operation();
    const totalWallMs = performance.now() - at, used = process.threadCpuUsage(cpu), work = metricDelta(before);
    assert.equal(parse.length, resets.length, 'each original native parse settles its reset');
    const parseWallMs = parse.reduce((sum, value) => sum + value.wallMs, 0);
    return { result, reads, work, parse, resetWallMs: resets, totalWallMs, cpu: used,
      postParseAndEntrypointWallMs: totalWallMs - parseWallMs,
      scope: 'separate instrumented original parser and native metadata pass;remainder includes projection/leaf/reset/entrypoint overhead;not clean latency or native memory' };
  } catch (error) { failed = true; primary = error; throw error; }
  finally {
    let cleanupFailed = false, cleanupFailure;
    for (const action of restore.reverse()) {
      try { action(); }
      catch (cleanup) {
        cleanupFailure = cleanupFailed ? addStorageFailureContext(cleanupFailure, {}, cleanup, { secondaryPresent: true }) : cleanup;
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) {
      if (failed) throw addStorageFailureContext(primary, {}, cleanupFailure, { secondaryPresent: true });
      throw cleanupFailure;
    }
  }
};
