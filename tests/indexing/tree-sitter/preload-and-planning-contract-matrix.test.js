#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildTreeSitterChunks,
  getTreeSitterCacheSnapshot,
  getTreeSitterStats,
  initTreeSitterRuntime,
  preloadTreeSitterLanguages
} from '../../../src/lang/tree-sitter.js';
import { pruneTreeSitterLanguages, resetTreeSitterStats } from '../../../src/lang/tree-sitter.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { LANGUAGE_GRAMMAR_KEYS } from '../../../src/lang/tree-sitter/config.js';
import {
  preflightNativeTreeSitterGrammars,
  warmupNativeTreeSitterParsers, getNativeTreeSitterParser, loadNativeTreeSitterGrammar
} from '../../../src/lang/tree-sitter/native-runtime.js';
import { resolveTreeSitterPreloadPlan } from '../../../src/index/build/indexer/steps/process-files/tree-sitter.js';
import { resolveTreeSitterRuntime } from '../../../src/index/build/runtime/tree-sitter.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const resetCaches = () => {
  treeSitterState.languageCache?.clear?.();
  treeSitterState.grammarCache?.clear?.();
  treeSitterState.languageLoadPromises?.clear?.();
  treeSitterState.queryCache?.clear?.();
  treeSitterState.loggedQueryFailures?.clear?.();
  treeSitterState.sharedParser = null;
  treeSitterState.sharedParserLanguageId = null;
};

const ok = await initTreeSitterRuntime({ log: () => {} });
assert.equal(ok, true, 'the prepared native runtime is required for preload/query qualification');

resetCaches();

await preloadTreeSitterLanguages(['javascript', 'python'], {
  skipDispose: true
});
{
  const snapshot = getTreeSitterCacheSnapshot();
  assert.ok(snapshot.loadedLanguages.includes('javascript'));
  assert.ok(snapshot.loadedLanguages.includes('python'));
  assert.ok(snapshot.loadedLanguages.length >= 2);
}

{
  const defaults = resolveTreeSitterRuntime({});
  assert.equal(defaults.treeSitterScheduler.transport, 'disk');
  assert.equal(defaults.treeSitterScheduler.sharedCache, false);
  assert.equal(defaults.treeSitterScheduler.closeTimeoutMs, null);
  assert.equal(defaults.treeSitterScheduler.closeForceAfterMs, null);

  const shmConfig = resolveTreeSitterRuntime({
    treeSitter: {
      scheduler: {
        transport: 'shm',
        sharedCache: true,
        lookup: {
          maxOpenReaders: 12,
          closeTimeoutMs: 7000,
          closeForceAfterMs: 1500
        }
      }
    }
  });
  assert.equal(shmConfig.treeSitterScheduler.transport, 'shm');
  assert.equal(shmConfig.treeSitterScheduler.sharedCache, true);
  assert.equal(shmConfig.treeSitterScheduler.maxOpenReaders, 12);
  assert.equal(shmConfig.treeSitterScheduler.closeTimeoutMs, 7000);
  assert.equal(shmConfig.treeSitterScheduler.closeForceAfterMs, 1500);
  assert.equal(shmConfig.treeSitterScheduler.lookup.maxOpenReaders, 12);
  assert.equal(shmConfig.treeSitterScheduler.lookup.closeTimeoutMs, 7000);
  assert.equal(shmConfig.treeSitterScheduler.lookup.closeForceAfterMs, 1500);

  const invalidTransport = resolveTreeSitterRuntime({
    treeSitter: {
      scheduler: {
        transport: 'invalid'
      }
    }
  });
  assert.equal(invalidTransport.treeSitterScheduler.transport, 'disk');
  assert.equal(invalidTransport.treeSitterScheduler.closeTimeoutMs, null);
}

{
  const entries = [
    { treeSitterBatchLanguages: ['javascript', 'html'] },
    { treeSitterBatchLanguages: ['javascript'] },
    { treeSitterBatchLanguages: ['python'] },
    { treeSitterBatchLanguages: ['html'] }
  ];
  const plan = resolveTreeSitterPreloadPlan(entries);
  assert.deepStrictEqual(plan.languages, ['html', 'javascript', 'python']);
}

{
  const malformedPreflight = preflightNativeTreeSitterGrammars({ javascript: true });
  assert.equal(malformedPreflight.ok, true);
  assert.deepEqual(malformedPreflight.missing, []);
  assert.deepEqual(malformedPreflight.unavailable, []);
  const malformedWarmup = warmupNativeTreeSitterParsers({ javascript: true });
  assert.deepEqual(malformedWarmup, { warmed: [], failed: [] });
}

{
  const options = {
    treeSitter: {
      enabled: true,
      useQueries: true,
      chunkCache: false
    },
    log: () => {}
  };

  const text = 'export class Widget { greet() {} }';
  resetTreeSitterStats();
  const first = buildTreeSitterChunks({ text, languageId: 'javascript', options });
  assert.ok(Array.isArray(first) && first.length, 'native query output is required');
  assert.ok(first.some(chunk => chunk.name === 'Widget' && chunk.kind === 'ClassDeclaration'));
  const key = 'native:javascript', firstQuery = treeSitterState.queryCache.get(key);
  assert.ok(firstQuery?.query, 'actual native query compiled');
  assert.equal(firstQuery.language, loadNativeTreeSitterGrammar('javascript').language);
  assert.equal(firstQuery.runtime, getNativeTreeSitterParser('javascript').constructor);
  const second = buildTreeSitterChunks({ text, languageId: 'javascript', options });
  assert.deepEqual(second, first);
  assert.strictEqual(treeSitterState.queryCache.get(key), firstQuery);
  assert.equal(treeSitterState.queryCache.has('javascript'), false, 'retired language-only namespace cannot certify native query readiness');
  assert.ok(getTreeSitterStats().queryBuilds >= 1 && getTreeSitterStats().queryHits >= 1);
  assert.ok(getTreeSitterStats().queryExecutions > 0); assert.equal(getTreeSitterStats().queryFailures, 0);
}

{
  resetTreeSitterStats();
  treeSitterState.disabledLanguages = new Set(['javascript']);
  const options = {
    treeSitter: { enabled: true, useQueries: false },
    log: () => {}
  };
  const text = 'function demo() { return 1; }';
  const before = getTreeSitterStats();
  const result = buildTreeSitterChunks({ text, languageId: 'javascript', options });
  const after = getTreeSitterStats();
  assert.equal(result, null, 'expected disabled language to fall back');
  assert.equal(Number(after.fallbacks) - Number(before.fallbacks), 1);
  treeSitterState.disabledLanguages = new Set();
}

{
  const missing = new Set();
  const result = buildTreeSitterChunks({
    text: 'function demo() {}',
    languageId: 'unsupported-language',
    options: {
      treeSitter: { enabled: true },
      treeSitterMissingLanguages: missing,
      log: () => {}
    }
  });
  assert.equal(result, null, 'expected missing grammar to fall back to heuristic chunking');
  assert.ok(missing.has('unsupported-language'));
}

{
  treeSitterState.TreeSitter = treeSitterState.TreeSitter || {};
  treeSitterState.grammarCache.clear();
  treeSitterState.languageCache.clear();
  for (const lang of ['javascript', 'python', 'go']) {
    const runtimeKey = LANGUAGE_GRAMMAR_KEYS[lang];
    treeSitterState.grammarCache.set(runtimeKey, { language: null, error: null });
    treeSitterState.languageCache.set(lang, { language: null, error: null });
  }
  const result = pruneTreeSitterLanguages(['python'], { skipDispose: true });
  assert.equal(result.removed, 0, 'prune should not evict native runtime entries');
  const remaining = Array.from(treeSitterState.grammarCache.keys());
  assert.ok(remaining.includes(LANGUAGE_GRAMMAR_KEYS.javascript));
  assert.ok(remaining.includes(LANGUAGE_GRAMMAR_KEYS.python));
  assert.ok(remaining.includes(LANGUAGE_GRAMMAR_KEYS.go));
}

console.log('tree-sitter preload and planning contract matrix test passed');
