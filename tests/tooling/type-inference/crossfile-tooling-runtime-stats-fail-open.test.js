#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runCrossFilePropagation } from '../../../src/index/type-inference-crossfile/propagation.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `crossfile-tooling-runtime-stats-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'lib'), { recursive: true });

const relFile = 'lib/app.dart';
const sourceText = 'String greet(String name) { return name; }\n';
await fs.writeFile(path.join(tempRoot, relFile), sourceText, 'utf8');

const stats = await runCrossFilePropagation({
  rootDir: tempRoot,
  buildRoot: tempRoot,
  chunks: [{
    file: relFile,
    name: 'greet',
    kind: 'function',
    lang: 'dart',
    containerLanguageId: 'dart',
    ext: '.dart',
    chunkUid: 'ck64:v1:test:lib/app.dart:runtime-stats',
    start: 0,
    end: sourceText.length,
    docmeta: { returnsValue: true },
    codeRelations: {}
  }],
  log: () => {},
  useTooling: true,
  enableTypeInference: true,
  enableRiskCorrelation: false,
  toolingConfig: {
    enabledTools: ['dart'],
    dart: {
      enabled: true,
      cmd: 'dart-not-found'
    }
  },
  toolingTimeoutMs: 1000,
  toolingRetries: 0,
  toolingBreaker: 1
});

assert.equal(Number(stats.toolingProvidersExecuted) >= 1, true, 'expected at least one executed tooling provider');
assert.equal(Number(stats.toolingDegradedProviders) >= 1, true, 'expected degraded provider count in fail-open path');
assert.equal(Number(stats.toolingRequests), 0, 'expected zero requests when provider command is unavailable');
assert.equal(Number(stats.toolingRequestFailures), 0, 'expected zero request failures without issued LSP requests');
assert.equal(Number(stats.toolingRequestTimeouts), 0, 'expected zero request timeouts without issued LSP requests');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('cross-file tooling runtime stats fail-open test passed');
