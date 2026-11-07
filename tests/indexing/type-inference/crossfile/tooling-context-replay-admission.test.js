#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';
import { buildCrossFileFingerprint, resolveCrossFileCacheLocation, writeCrossFileInferenceCache,
  readCrossFileInferenceCache } from '../../../../src/index/type-inference-crossfile/cache.js';
import { registerToolingProvider, TOOLING_PROVIDERS } from '../../../../src/index/tooling/provider-registry.js';
import { sha1 } from '../../../../src/shared/hash.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';

const { dir: root } = await prepareIsolatedTestCacheDir('tooling-context-replay');
const text = 'export function subject(value: string) { return value; }';
await fs.writeFile(path.join(root, 'subject.ts'), text);
const saved = new Map(TOOLING_PROVIDERS), providerId = 'context-identity-fixture';
let calls = 0;
registerToolingProvider({ id: providerId, version: '1.0.0', priority: 1, languages: ['typescript'], kinds: ['types'],
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: ctx => String(ctx.toolingConfig.timeoutMs),
  async run(ctx, inputs) {
    calls++;
    assert.equal(inputs.targets.length, 1);
    const chunkUid = inputs.targets[0].chunkRef.chunkUid;
    return { byChunkUid: { [chunkUid]: { payload: { returnType: ctx.toolingConfig.timeoutMs === 1000 ? 'Before' : 'After' } } } };
  } });
const cacheRoot = path.join(root, 'cache');
const fresh = () => [{ chunkUid: 'subject:tooling-context', file: 'subject.ts', fileHash: sha1(text), fileHashAlgo: 'sha1',
  lang: 'typescript', kind: 'FunctionDeclaration', name: 'subject', start: 0, end: text.length,
  docmeta: { params: ['value'] }, codeRelations: {} }];
const fingerprint = buildCrossFileFingerprint({ chunks: fresh(), enableTypeInference: true,
  enableRiskCorrelation: false, useTooling: true, fileRelations: null });
const { cacheDir, cachePath } = resolveCrossFileCacheLocation({ cacheRoot, rootDir: root });
const stale = fresh(); stale[0].docmeta.inferredTypes = { returns: [{ type: 'StaleCachedType', source: 'tooling', confidence: 1 }] };
await writeCrossFileInferenceCache({ cacheDir, cachePath, chunks: stale, crossFileFingerprint: fingerprint,
  stats: { inferredReturns: 1 }, maxBytes: 1024 * 1024 });
const control = fresh();
assert.ok(await readCrossFileInferenceCache({ cachePath, chunks: control, crossFileFingerprint: fingerprint, requireComplete: true }),
  'control must admit the actual complete old output when asked without tooling-context qualification');
assert.equal(control[0].docmeta.inferredTypes.returns[0].type, 'StaleCachedType');
const original = await fs.readFile(cachePath);
try {
  for (const [timeoutMs, expected] of [[1000, 'Before'], [2000, 'After']]) {
    applyTestEnv({ testConfig: { tooling: { autoEnableOnDetect: true, enabledTools: [providerId],
      timeoutMs, maxRetries: 0, cache: { enabled: false }, typescript: { typeRepresentation: 'legacy' } } } });
    const chunks = fresh();
    const result = await applyCrossFileInference({ rootDir: root, buildRoot: root, cacheRoot,
      chunks, enabled: true, cacheEnabled: true, useTooling: true,
      enableTypeInference: true, enableRiskCorrelation: false, log() {} });
    assert.equal(result.cacheHit, false, 'a fingerprint without compiler/config/ambient identity cannot authorize tooling replay');
    assert.equal(result.fingerprint, fingerprint, 'identical source inputs expose the original insufficient identity');
    const tooling = chunks[0].docmeta.inferredTypes.returns.filter(row => row.source === 'tooling');
    assert.deepEqual(tooling.map(row => row.type), [expected]);
    assert.deepEqual(await fs.readFile(cachePath), original, 'unqualified tooling output cannot replace reusable cache data');
  }
  assert.equal(calls, 2, 'configuration-only change reaches the selected fixture provider, without a native server');
} finally {
  TOOLING_PROVIDERS.clear(); for (const [id, provider] of saved) TOOLING_PROVIDERS.set(id, provider);
}
console.log('Unqualified tooling contexts recompute providers instead of restoring stale complete cross-file output.');
