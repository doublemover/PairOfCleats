#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  createRuntimeSqlDialectResolver,
  resolveRuntimeLanguageInitConfig
} from '../../../src/index/build/runtime/runtime-language-init.js';

applyTestEnv();

{
  const runtimeConfig = resolveRuntimeLanguageInitConfig({
    typescript: {
      importsOnly: true,
      embeddingBatchMultiplier: 2.5
    },
    embeddingBatchMultipliers: {
      javascript: 1.25
    },
    tokenization: {
      fileStream: false
    },
    chunking: {
      maxBytes: 8192,
      maxLines: 77
    },
    yamlChunking: 'top-level',
    yamlTopLevelMaxBytes: 12345,
    kotlin: {
      flowMaxBytes: 10000,
      flowMaxLines: 222,
      relationsMaxBytes: 20000,
      relationsMaxLines: 333
    },
    pythonAst: {
      enabled: false,
      maxWorkers: 9
    },
    javascript: {
      parser: 'acorn',
      flow: 'on'
    },
    typescriptParser: 'typescript',
    segments: {
      onlyExtras: true
    },
    comments: {
      extract: 'all'
    }
  });

  assert.equal(runtimeConfig.typescriptImportsOnly, true, 'expected typescript imports-only flag to pass through');
  assert.equal(runtimeConfig.embeddingBatchMultipliers.javascript, 1.25, 'expected explicit embedding multiplier pass-through');
  assert.equal(runtimeConfig.embeddingBatchMultipliers.typescript, 2.5, 'expected typescript embedding fallback injection');
  assert.equal(runtimeConfig.tokenizationFileStream, false, 'expected tokenization.fileStream override');
  assert.deepEqual(runtimeConfig.chunking, { maxBytes: 8192, maxLines: 77 }, 'expected chunking override values');
  assert.equal(runtimeConfig.yamlChunkingMode, 'top-level', 'expected yaml chunking mode normalization');
  assert.equal(runtimeConfig.yamlTopLevelMaxBytes, 12345, 'expected yaml top-level max bytes normalization');
  assert.equal(runtimeConfig.kotlinFlowMaxBytes, 10000, 'expected kotlin flow max bytes normalization');
  assert.equal(runtimeConfig.kotlinFlowMaxLines, 222, 'expected kotlin flow max lines normalization');
  assert.equal(runtimeConfig.kotlinRelationsMaxBytes, 20000, 'expected kotlin relations max bytes normalization');
  assert.equal(runtimeConfig.kotlinRelationsMaxLines, 333, 'expected kotlin relations max lines normalization');
  assert.equal(runtimeConfig.pythonAstConfig.enabled, false, 'expected pythonAst config pass-through');
  assert.equal(runtimeConfig.parserConfig.javascript, 'acorn', 'expected parser config normalization for javascript');
  assert.equal(runtimeConfig.parserConfig.typescript, 'typescript', 'expected parser config normalization for typescript');
  assert.equal(runtimeConfig.flowConfig.javascript, 'on', 'expected flow setting normalization');
  assert.equal(runtimeConfig.segmentsConfig.onlyExtras, true, 'expected segments config normalization');
  assert.equal(runtimeConfig.commentsConfig.extract, 'all', 'expected comments config normalization');
}

{
  const defaults = resolveRuntimeLanguageInitConfig({
    yamlChunking: 'invalid',
    yamlTopLevelMaxBytes: 'invalid'
  });

  assert.equal(defaults.yamlChunkingMode, 'auto', 'expected unsupported yaml mode to fall back to auto');
  assert.equal(defaults.yamlTopLevelMaxBytes, 200 * 1024, 'expected yaml top-level max bytes fallback');
}

{
  const resolveByExt = createRuntimeSqlDialectResolver({
    dialectByExt: {
      '.foo': 'oracle'
    }
  });

  assert.equal(resolveByExt('.foo'), 'oracle', 'expected extension mapping to apply');
  assert.equal(resolveByExt('.psql'), 'postgres', 'expected default extension mappings retained');
  assert.equal(resolveByExt('.nope'), 'generic', 'expected unknown extension to use generic fallback');

  const resolveByOverride = createRuntimeSqlDialectResolver({ dialect: 'sqlite' });
  assert.equal(resolveByOverride('.foo'), 'sqlite', 'expected explicit dialect override to take precedence');
}

console.log('runtime language init test passed');
