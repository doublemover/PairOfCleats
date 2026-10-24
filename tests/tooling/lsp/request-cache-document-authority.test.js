import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parseGenericSignature } from '../../../src/index/tooling/lsp-provider/runtime.js';
import { resolveRequestCacheGeneration } from '../../../src/index/tooling/provider-contract.js';
import { computeDocHash } from '../../../src/index/tooling/vfs/doc-hash.js';
import { buildSingleSymbolInputs } from '../../helpers/lsp-provider-fixture.js';
import { cleanupLspTestRuntime } from '../../helpers/lsp-runtime.js';
import { grantFixtureRepositoryExecution } from '../../helpers/execution-authority.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('lsp-document-authority');
applyTestEnv({ cacheRoot: path.join(dir, 'cache') });
const restore = grantFixtureRepositoryExecution(dir);
const text = 'from .dependency import value\ndef fetch():\n  return value\n';
const docHash = await computeDocHash(text);
const inputs = ['alpha', 'beta', 'gamma'].map(name => buildSingleSymbolInputs({ scenarioName: name,
  virtualPath: `${name}/source.py`, text, languageId: 'python', effectiveExt: '.py', symbolName: 'fetch' }));
const typesPath = path.join(dir, 'dependency-types.json');
const generation = id => resolveRequestCacheGeneration({ repoRoot: dir, buildRoot: dir, mode: 'code', buildId: id });
const run = requestCacheGeneration => collectLspTypes({ rootDir: dir, vfsRoot: dir,
  cacheRoot: path.join(dir, 'responses'), requestCacheGeneration,
  documents: inputs.flatMap(input => input.documents.map(doc => ({ ...doc, docHash, containerPath: doc.virtualPath }))),
  targets: inputs.flatMap(input => input.targets), providerId: 'fixture-python-origin', providerVersion: '1',
  cmd: process.execPath, args: [path.resolve('tests/fixtures/lsp/document-origin-server.js'), typesPath],
  parseSignature: parseGenericSignature, documentSymbolConcurrency: 1, hoverConcurrency: 1, signatureHelpConcurrency: 1 });
const assertResults = (result, alphaType) => {
  assert.equal(result.byChunkUid[inputs[0].chunkUid]?.payload?.returnType, alphaType);
  assert.equal(result.byChunkUid[inputs[1].chunkUid]?.payload?.returnType, 'str');
  assert.ok(!result.byChunkUid[inputs[2].chunkUid]?.payload?.returnType, 'negative origin cannot borrow another file’s positive answer');
};
try {
  await fs.writeFile(typesPath, JSON.stringify({ alpha: 'int', beta: 'str', gamma: null }));
  const first = await run(generation('build-one'));
  assertResults(first, 'int');
  const repeated = await run(generation('build-one'));
  assertResults(repeated, 'int');
  assert.ok(repeated.runtime.requestCache.persistedHits >= 2, 'same immutable generation/file reuses its own positive and negative answers');
  assert.ok(repeated.runtime.requestCache.negativeHits > 0);
  await fs.writeFile(typesPath, JSON.stringify({ alpha: 'bool', beta: 'str', gamma: null }));
  const changed = await run(generation('build-two'));
  assertResults(changed, 'bool');
  assert.equal(changed.runtime.requestCache.persistedHits, 0, 'dependency-only build changes invalidate unchanged source text');
  for (let call = 0; call < 2; call++) {
    const unscoped = await run(null);
    assertResults(unscoped, 'bool');
    assert.equal(unscoped.runtime.requestCache.persistedHits, 0, 'unscoped callers cannot claim cross-invocation dependency freshness');
  }
} finally {
  await cleanupLspTestRuntime({ reason: 'request_cache_document_authority_complete', strict: true });
  restore();
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Real LSP hover/signature responses isolate equal-byte origins, reuse a pinned generation and refresh dependency-only builds');
