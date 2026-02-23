#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildRuntimeLanguageOptions } from '../../../src/index/build/runtime/runtime-language-options.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const baseInput = {
  root: '/repo',
  astDataflowEnabled: true,
  controlFlowEnabled: true,
  skipUnknownLanguages: false,
  skipOnParseError: true,
  parserConfig: {
    javascript: { mode: 'hybrid' },
    typescript: { mode: 'hybrid' }
  },
  flowConfig: {
    javascript: { enabled: true }
  },
  typescriptImportsOnly: false,
  embeddingBatchMultipliers: { javascript: 2 },
  chunking: { mode: 'semantic' },
  tokenizationFileStream: true,
  pythonAstRuntimeConfig: { enabled: true },
  kotlinFlowMaxBytes: 1024,
  kotlinFlowMaxLines: 128,
  kotlinRelationsMaxBytes: 2048,
  kotlinRelationsMaxLines: 256,
  treeSitterEnabled: true,
  treeSitterLanguages: ['javascript', 'typescript'],
  treeSitterConfigChunking: true,
  treeSitterMaxBytes: 4096,
  treeSitterMaxLines: 512,
  treeSitterMaxParseMs: 250,
  treeSitterByLanguage: { javascript: { maxParseMs: 250 } },
  treeSitterPreload: true,
  treeSitterPreloadConcurrency: 2,
  treeSitterBatchByLanguage: true,
  treeSitterBatchEmbeddedLanguages: false,
  treeSitterLanguagePasses: 2,
  treeSitterDeferMissing: true,
  treeSitterDeferMissingMax: 4,
  treeSitterCachePersistent: true,
  resolvedTreeSitterCachePersistentDir: '/cache/tree-sitter',
  treeSitterWorker: false,
  treeSitterScheduler: null,
  resolveSqlDialect: () => 'postgresql',
  yamlChunkingMode: 'top-level',
  yamlTopLevelMaxBytes: 8192,
  lexiconConfig: { enabled: true },
  log: () => {}
};

const fallbackOptions = buildRuntimeLanguageOptions(baseInput);
assert.equal(fallbackOptions.rootDir, '/repo');
assert.equal(fallbackOptions.treeSitter.scheduler.transport, 'disk');
assert.equal(fallbackOptions.treeSitter.scheduler.sharedCache, false);
assert.equal(fallbackOptions.tokenization.fileStream, true);
assert.deepEqual(fallbackOptions.javascript, {
  parser: { mode: 'hybrid' },
  flow: { enabled: true }
});

const explicitScheduler = { transport: 'shared-memory', sharedCache: true };
const explicitOptions = buildRuntimeLanguageOptions({
  ...baseInput,
  treeSitterScheduler: explicitScheduler
});
assert.equal(explicitOptions.treeSitter.scheduler, explicitScheduler);
assert.equal(explicitOptions.kotlin.flowMaxLines, 128);
assert.equal(typeof explicitOptions.resolveSqlDialect, 'function');

console.log('runtime language options helper test passed');
