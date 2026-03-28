#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyCrossFileInference } from '../../../src/index/type-inference-crossfile.js';
import {
  CROSS_FILE_CACHE_SCHEMA_VERSION,
  readCrossFileInferenceCache,
  resolveChunkIdentity
} from '../../../src/index/type-inference-crossfile/cache.js';
import { runCrossFilePropagation } from '../../../src/index/type-inference-crossfile/propagation.js';
import {
  __resolveDefaultToolingCacheDirForTests,
  runToolingPass
} from '../../../src/index/type-inference-crossfile/tooling.js';
import { registerToolingProvider, TOOLING_PROVIDERS } from '../../../src/index/tooling/provider-registry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-runtime-contract-matrix-${process.pid}-${Date.now()}`);

const buildChunk = ({ file, name, uid, relations = null }) => ({
  file,
  name,
  kind: 'function',
  chunkUid: uid,
  start: 0,
  end: 1,
  docmeta: {},
  codeRelations: relations || {}
});

const runCacheRootCases = () => {
  const repoRoot = path.win32.resolve('C:\\repo\\project');
  const repoCacheBuildRoot = path.win32.resolve('C:\\cache-root\\repos\\project\\builds\\20260307T000000Z_deadbeef');
  assert.equal(
    __resolveDefaultToolingCacheDirForTests({ rootDir: repoRoot, buildRoot: repoCacheBuildRoot }),
    path.win32.resolve('C:\\cache-root\\repos\\project\\tooling-cache')
  );

  const explicitBuildRoot = path.win32.resolve('C:\\tmp\\explicit-index-root');
  assert.equal(
    __resolveDefaultToolingCacheDirForTests({ rootDir: repoRoot, buildRoot: explicitBuildRoot }),
    path.win32.resolve('C:\\repo\\project\\.build\\pairofcleats\\tooling-cache')
  );

  const posixRoot = path.posix.resolve('/repo/project');
  const posixBuildRoot = path.posix.resolve('/cache-root/repos/project/builds/20260307T000000Z_deadbeef');
  assert.equal(
    __resolveDefaultToolingCacheDirForTests({ rootDir: posixRoot, buildRoot: posixBuildRoot }),
    path.posix.resolve('/cache-root/repos/project/tooling-cache')
  );
};

const runCacheNormalizationCases = async () => {
  const caseRoot = path.join(tempRoot, 'cache-normalization');
  await fs.rm(caseRoot, { recursive: true, force: true });
  await fs.mkdir(caseRoot, { recursive: true });

  const cachePath = path.join(caseRoot, 'output-cache.json');
  const chunks = [{
    chunkUid: 'uid-alpha',
    file: 'src/alpha.js',
    name: 'alpha',
    start: 0,
    end: 24,
    codeRelations: {},
    docmeta: {}
  }];
  const rowId = resolveChunkIdentity(chunks[0], 0);

  const writePayload = async (stats) => {
    await fs.writeFile(cachePath, JSON.stringify({
      schemaVersion: CROSS_FILE_CACHE_SCHEMA_VERSION,
      fingerprint: 'degraded-fingerprint',
      stats,
      rows: [{
        id: rowId,
        codeRelations: { calls: [] },
        docmeta: { signature: 'alpha()' }
      }]
    }), 'utf8');
  };

  await writePayload({
    linkedCalls: 1,
    linkedUsages: 2,
    inferredReturns: 3,
    riskFlows: 4,
    toolingDegradedProviders: 2,
    toolingDegradedWarnings: 5,
    toolingDegradedErrors: 1,
    toolingProvidersExecuted: 3,
    toolingProvidersContributed: 1,
    toolingRequests: 7,
    toolingRequestFailures: 2,
    toolingRequestTimeouts: 1
  });

  const withDegraded = await readCrossFileInferenceCache({
    cachePath,
    chunks,
    crossFileFingerprint: 'degraded-fingerprint',
    log: () => {}
  });
  assert.equal(withDegraded.toolingDegradedProviders, 2);
  assert.equal(withDegraded.toolingDegradedWarnings, 5);
  assert.equal(withDegraded.toolingDegradedErrors, 1);
  assert.equal(withDegraded.toolingProvidersExecuted, 3);
  assert.equal(withDegraded.toolingProvidersContributed, 1);
  assert.equal(withDegraded.toolingRequests, 7);
  assert.equal(withDegraded.toolingRequestFailures, 2);
  assert.equal(withDegraded.toolingRequestTimeouts, 1);

  await writePayload({
    linkedCalls: 7,
    linkedUsages: 8,
    inferredReturns: 9,
    riskFlows: 10
  });

  const withoutDegraded = await readCrossFileInferenceCache({
    cachePath,
    chunks,
    crossFileFingerprint: 'degraded-fingerprint',
    log: () => {}
  });
  assert.equal(withoutDegraded.toolingDegradedProviders, 0);
  assert.equal(withoutDegraded.toolingDegradedWarnings, 0);
  assert.equal(withoutDegraded.toolingDegradedErrors, 0);
  assert.equal(withoutDegraded.toolingProvidersExecuted, 0);
  assert.equal(withoutDegraded.toolingProvidersContributed, 0);
  assert.equal(withoutDegraded.toolingRequests, 0);
  assert.equal(withoutDegraded.toolingRequestFailures, 0);
  assert.equal(withoutDegraded.toolingRequestTimeouts, 0);
};

const runFailOpenRuntimeCase = async () => {
  const caseRoot = path.join(tempRoot, 'runtime-fail-open');
  const relFile = 'lib/app.dart';
  const sourceText = 'String greet(String name) { return name; }\n';

  await fs.rm(caseRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(caseRoot, 'lib'), { recursive: true });
  await fs.writeFile(path.join(caseRoot, relFile), sourceText, 'utf8');

  const stats = await runCrossFilePropagation({
    rootDir: caseRoot,
    buildRoot: caseRoot,
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
      dart: { enabled: true, cmd: 'dart-not-found' }
    },
    toolingTimeoutMs: 1000,
    toolingRetries: 0,
    toolingBreaker: 1
  });

  assert.equal(Number(stats.toolingProvidersExecuted) >= 1, true);
  assert.equal(Number(stats.toolingDegradedProviders) >= 1, true);
  assert.equal(Number(stats.toolingRequests), 0);
  assert.equal(Number(stats.toolingRequestFailures), 0);
  assert.equal(Number(stats.toolingRequestTimeouts), 0);
};

const runBudgetCase = async () => {
  const targets = Array.from({ length: 320 }, (_, i) => buildChunk({
    file: `src/targets_${Math.floor(i / 40)}.js`,
    name: `target_${i}`,
    uid: `uid-target-${i}`
  }));

  const largeCallList = targets.map((chunk) => ['caller', chunk.name]);
  const largeUsageList = targets.map((chunk) => chunk.name);
  const caller = buildChunk({
    file: 'src/caller.js',
    name: 'caller',
    uid: 'uid-caller',
    relations: {
      calls: largeCallList,
      usages: largeUsageList
    }
  });

  const fillers = Array.from({ length: 2700 }, (_, i) => buildChunk({
    file: `src/filler_${Math.floor(i / 40)}.js`,
    name: `filler_${i}`,
    uid: `uid-filler-${i}`
  }));

  const logs = [];
  const stats = await applyCrossFileInference({
    rootDir: root,
    chunks: [caller, ...targets, ...fillers],
    enabled: true,
    log: (line) => logs.push(String(line)),
    useTooling: false,
    enableTypeInference: false,
    enableRiskCorrelation: false,
    fileRelations: null
  });

  assert.ok(stats.linkedCalls <= 96);
  assert.ok(stats.linkedUsages <= 128);
  assert.ok(stats.droppedCallLinks > 0);
  assert.ok(stats.droppedUsageLinks > 0);
  assert.ok(logs.some((line) => line.includes('[perf] cross-file budget enabled')));
};

const runToolingPassCases = async () => {
  TOOLING_PROVIDERS.clear();
  registerToolingProvider({
    id: 'configured-paths-fixture',
    version: '1.0.0',
    kinds: ['types'],
    capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
    getConfigHash: () => 'configured-paths-fixture-v1',
    async run() {
      return {
        byChunkUid: {
          'chunk-1': { returnType: 'number' }
        },
        diagnostics: {
          'configured-paths-fixture': {
            diagnosticsByChunkUid: {
              'chunk-1': [{ severity: 'info', message: 'fixture diag' }]
            }
          }
        }
      };
    }
  });
  registerToolingProvider({
    id: 'doctor-scope-fixture',
    version: '1.0.0',
    kinds: ['types'],
    capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
    getConfigHash: () => 'doctor-scope-fixture-v1',
    async run() {
      return {
        byChunkUid: {
          'chunk-1': { returnType: 'number' }
        }
      };
    }
  });

  const caseRoot = path.join(tempRoot, 'tooling-pass');
  const sourceDir = path.join(caseRoot, 'src');
  const absCacheDir = path.join(caseRoot, 'cache-root');
  const absLogDir = path.join(caseRoot, 'log-root');
  await fs.rm(caseRoot, { recursive: true, force: true });
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.mkdir(absCacheDir, { recursive: true });
  await fs.mkdir(absLogDir, { recursive: true });

  const chunks = [{
    chunkUid: 'chunk-1',
    chunkId: 'chunk-1',
    file: 'src/sample.js',
    start: 0,
    end: 34,
    name: 'sum',
    kind: 'function',
    docmeta: {},
    metaV2: { symbol: { qualifiedName: 'sum' } }
  }];

  const entryByUid = new Map([[
    'chunk-1',
    {
      name: 'sum',
      file: 'src/sample.js',
      kind: 'function',
      chunkUid: 'chunk-1',
      qualifiedName: 'sum',
      paramTypes: {}
    }
  ]]);

  const logs = [];
  const result = await runToolingPass({
    rootDir: caseRoot,
    buildRoot: caseRoot,
    chunks,
    entryByUid,
    log: (line) => logs.push(String(line || '')),
    toolingConfig: {
      enabledTools: ['configured-paths-fixture', 'doctor-scope-fixture'],
      cache: { enabled: true, dir: absCacheDir },
      doctorCache: false
    },
    toolingTimeoutMs: 2000,
    toolingRetries: 0,
    toolingBreaker: 1,
    toolingLogDir: absLogDir,
    fileTextByFile: new Map([
      ['src/sample.js', 'function sum(a, b) { return a + b; }\n']
    ]),
    abortSignal: null
  });

  assert.equal(Number(result.toolingProvidersExecuted) >= 1, true);
  assert.equal(logs.some((line) => line.includes('[tooling] providers:done')), true);
  assert.ok(logs.some((line) => line.includes('[tooling] providers:selected count=')));
  assert.ok(logs.some((line) => line.includes('[tooling] providers:start docs=1 targets=1.')));
  assert.equal(logs.some((line) => line.includes('[tooling] doctor:')), false);
};

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

try {
  runCacheRootCases();
  await runCacheNormalizationCases();
  await runFailOpenRuntimeCase();
  await runBudgetCase();
  await runToolingPassCases();
  console.log('tooling runtime contract matrix test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
