#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { ensureChunkCache, resolveChunkCacheKey, resolvePersistentChunkCacheRoot, storeCachedChunks, loadCachedChunks } from '../../../src/lang/tree-sitter/chunking/cache.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { loadImportResolutionCache, saveImportResolutionCache } from '../../../src/index/build/import-resolution-cache.js';
import { loadLspRequestCache, persistLspRequestCache } from '../../../src/integrations/tooling/providers/lsp/hover-types/cache.js';
import { writePersistentCommandProbeCache, readPersistentCommandProbeCache } from '../../../src/index/tooling/command-probe-persistent-cache.js';
import { writeWorkspaceCommandPreflightCacheMarker } from '../../../src/index/tooling/preflight/workspace-command-preflight-cache.js';
import { classifyGeneratedArtifactCachePrefix, withoutGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';

applyTestEnv({ testing: '1' });
const root = resolveTestCachePath(process.cwd(), 'object-cache-metadata-roundtrip');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
const inspect = async (file, artifact) => {
  const prefix = await fs.readFile(file, 'utf8');
  const payload = JSON.parse(prefix);
  assert.equal(Object.keys(payload)[0], '__poc_generated');
  assert.equal(classifyGeneratedArtifactCachePrefix({ prefix })?.artifact, artifact);
  return payload;
};
const makeLegacy = async (file, payload) => fs.writeFile(file, JSON.stringify(withoutGeneratedCacheMetadata(payload)));

try {
  const options = { treeSitter: { cachePersistent: true, cachePersistentDir: path.join(root, 'chunks'), cacheKey: 'fixture' } };
  const cacheRoot = resolvePersistentChunkCacheRoot(options);
  const key = resolveChunkCacheKey(options, 'javascript');
  const { cache, maxEntries } = ensureChunkCache(options);
  const chunks = [{ start: 0, end: 12, text: 'const x = 1;', meta: { signature: 'x' } }];
  storeCachedChunks({ cache, maxEntries, key, chunks, cacheRoot });
  const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, '_');
  const chunkFile = path.join(cacheRoot, safeKey.slice(0, 2), `${safeKey}.json`);
  const chunkPayload = await inspect(chunkFile, 'tree-sitter-chunks');
  for (const legacy of [false, true]) {
    if (legacy) await makeLegacy(chunkFile, chunkPayload);
    cache.clear();
    treeSitterState.persistentChunkCacheMemo.clear();
    treeSitterState.persistentChunkCacheMisses.clear();
    assert.deepEqual(loadCachedChunks({ cache, key, cacheRoot }), chunks, 'chunk payload parity');
  }

  const incrementalState = { incrementalDir: path.join(root, 'incremental') };
  const initial = await loadImportResolutionCache({ incrementalState });
  await saveImportResolutionCache({ cache: initial.cache, cachePath: initial.cachePath });
  const importPayload = await inspect(initial.cachePath, 'import-resolution');
  const markedImport = await loadImportResolutionCache({ incrementalState });
  await makeLegacy(initial.cachePath, importPayload);
  const legacyImport = await loadImportResolutionCache({ incrementalState });
  assert.deepEqual(markedImport.cache, legacyImport.cache, 'import normalization must ignore persistence metadata');
  assert.ok(!Object.hasOwn(markedImport.cache.files, '__poc_generated'));

  const lsp = await loadLspRequestCache(root);
  lsp.entries.set('positive', { requestKind: 'hover', info: { signature: 'f()', returnType: 'number' }, at: Date.now() });
  lsp.entries.set('negative', { requestKind: 'hover', negative: true, at: Date.now(), expiresAt: Date.now() + 60000 });
  lsp.entries.set('expired', { requestKind: 'hover', negative: true, at: 1, expiresAt: 2 });
  await persistLspRequestCache({ cachePath: lsp.path, entries: lsp.entries, maxEntries: 1000 });
  const lspPayload = await inspect(lsp.path, 'lsp-requests');
  const markedLsp = await loadLspRequestCache(root);
  assert.deepEqual([...markedLsp.entries.keys()].sort(), ['negative', 'positive']);
  await makeLegacy(lsp.path, lspPayload);
  assert.deepEqual((await loadLspRequestCache(root)).entries, markedLsp.entries);

  const commandArgs = { providerId: 'fixture', command: process.execPath, args: ['--version'], toolingConfig: { cache: { dir: root } }, successTtlMs: 60000 };
  assert.equal(writePersistentCommandProbeCache({ ...commandArgs, attempted: [{ command: process.execPath, ok: true }] }), true);
  const commandDir = path.join(root, 'command-probes');
  const commandFile = path.join(commandDir, (await fs.readdir(commandDir))[0]);
  const commandPayload = await inspect(commandFile, 'command-probe');
  const markedCommand = readPersistentCommandProbeCache(commandArgs);
  assert.equal(markedCommand?.ok, true);
  await makeLegacy(commandFile, commandPayload);
  assert.deepEqual(readPersistentCommandProbeCache(commandArgs), markedCommand);
  assert.equal(readPersistentCommandProbeCache({ ...commandArgs, args: ['different'] }), null);

  const preflightArgs = { repoRoot: root, cacheRoot: root, namespace: 'fixture', fingerprint: 'fp', command: 'fixture', args: [] };
  const preflightFile = await writeWorkspaceCommandPreflightCacheMarker(preflightArgs);
  const preflightPayload = await inspect(preflightFile, 'workspace-preflight');
  const markedReader = await import('../../../src/index/tooling/preflight/workspace-command-preflight-cache.js?marked-reader');
  const markedPreflight = await markedReader.readWorkspaceCommandPreflightCacheHit(preflightArgs);
  assert.equal(markedPreflight.hit, true);
  assert.equal(markedPreflight.marker.__poc_generated, undefined, 'persistence metadata stays outside marker API');
  await makeLegacy(preflightFile, preflightPayload);
  const legacyReader = await import('../../../src/index/tooling/preflight/workspace-command-preflight-cache.js?legacy-reader');
  assert.deepEqual(await legacyReader.readWorkspaceCommandPreflightCacheHit(preflightArgs), markedPreflight);
  assert.equal((await legacyReader.readWorkspaceCommandPreflightCacheHit({ ...preflightArgs, fingerprint: 'changed' })).hit, false);
  console.log('object-cache metadata preserves legacy reads, fingerprints, TTL and payloads');
} finally {
  cacheCleanup();
  await fs.rm(root, { recursive: true, force: true });
}

function cacheCleanup() {
  treeSitterState.chunkCache?.clear();
  treeSitterState.persistentChunkCacheMemo?.clear();
  treeSitterState.persistentChunkCacheMisses?.clear();
  treeSitterState.persistentChunkCacheRoot = null;
}
