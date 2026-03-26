#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildTreeSitterChunks,
  getTreeSitterCacheSnapshot,
  initTreeSitterRuntime,
  preloadTreeSitterLanguages
} from '../../../src/lang/tree-sitter.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { resolveTreeSitterPreloadPlan } from '../../../src/index/build/indexer/steps/process-files/tree-sitter.js';
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
if (!ok) {
  console.log('tree-sitter runtime unavailable; skipping preload/planning matrix test.');
  process.exit(0);
}

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
  const options = {
    treeSitter: {
      enabled: true,
      useQueries: true
    },
    log: () => {}
  };

  const text = 'export class Widget { greet() {} }';
  const first = buildTreeSitterChunks({ text, languageId: 'javascript', options });
  if (!Array.isArray(first) || !first.length) {
    console.log('tree-sitter chunking unavailable; skipping query cache assertions.');
  } else {
    assert.ok(treeSitterState.queryCache.has('javascript'));
    const firstQuery = treeSitterState.queryCache.get('javascript');
    const second = buildTreeSitterChunks({ text, languageId: 'javascript', options });
    assert.ok(second && second.length);
    assert.strictEqual(treeSitterState.queryCache.get('javascript'), firstQuery);
  }
}

console.log('tree-sitter preload and planning contract matrix test passed');
