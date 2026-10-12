import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLocalCacheKey } from '../../src/shared/cache-key.js';
import {
  __resolveSystemCacheAliasForTests,
  assertToolingCachePath, readToolingCacheEntry, removeToolingCacheEntry,
  writeToolingCacheJson, writeToolingCacheJsonSync
} from '../../src/index/tooling/cache-storage.js';
import {
  writePersistentCommandProbeCache, readPersistentCommandProbeCache, invalidatePersistentCommandProbeCache
} from '../../src/index/tooling/command-probe-persistent-cache.js';
import {
  buildWorkspaceCommandPreflightFingerprint, readWorkspaceCommandPreflightCacheHit,
  writeWorkspaceCommandPreflightCacheMarker
} from '../../src/index/tooling/preflight/workspace-command-preflight-cache.js';
import { persistPyrightPlannerHealth } from '../../src/index/tooling/pyright-planner.js';
import { persistPyrightRuntimeHealth } from '../../src/index/tooling/pyright-runtime-health.js';
import { persistLspRequestCache } from '../../src/integrations/tooling/providers/lsp/hover-types/cache.js';
import { createVfsColdStartCache } from '../../src/index/tooling/vfs/cold-start.js';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../src/index/tooling/orchestrator.js';
import { createToolingProviderFixtureInput } from '../tooling/providers/provider-run-fixture.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'poc-tooling-cache-storage-')));
const cache = path.join(tmp, 'cache');
const outside = path.join(tmp, 'outside');
const probes = path.join(cache, 'command-probes');
const command = path.join(tmp, 'inert-command');
fs.writeFileSync(command, 'Inert fixture, never executed.');
fs.mkdirSync(probes, { recursive: true });
fs.mkdirSync(outside);
const inputs = { providerId: 'fixture', command, cwd: tmp, args: ['first'], successTtlMs: 60000,
  toolingConfig: { cache: { dir: cache } }, attempted: [{ ok: true }] };
const readProbeFiles = () => fs.readdirSync(probes).sort();
const ancient = new Date('2000-01-01');

try {
  // Guarded persistence must preserve real watched-file invalidation. A missing
  // fs import previously turned every digest into the same caught error value.
  const watchedFile = path.join(tmp, 'watched.txt');
  const preflightInputs = { repoRoot: tmp, cacheRoot: path.join(tmp, 'fingerprint-cache'),
    namespace: 'fingerprint', command: 'inert', args: [] };
  const contentInputs = { ...preflightInputs, watchedFiles: [{ path: watchedFile, mode: 'content' }] };
  fs.writeFileSync(watchedFile, 'alpha');
  const originalFingerprint = await buildWorkspaceCommandPreflightFingerprint(contentInputs);
  assert.equal(await buildWorkspaceCommandPreflightFingerprint(contentInputs), originalFingerprint,
    'unchanged content has a stable fingerprint');
  await writeWorkspaceCommandPreflightCacheMarker({ ...preflightInputs, fingerprint: originalFingerprint });
  assert.equal((await readWorkspaceCommandPreflightCacheHit({ ...preflightInputs, fingerprint: originalFingerprint })).hit, true);
  fs.writeFileSync(watchedFile, 'bravo');
  const changedFingerprint = await buildWorkspaceCommandPreflightFingerprint(contentInputs);
  assert.notEqual(changedFingerprint, originalFingerprint, 'same-length content changes invalidate the fingerprint');
  assert.equal((await readWorkspaceCommandPreflightCacheHit({ ...preflightInputs, fingerprint: changedFingerprint })).hit, false,
    'changed watched content rejects both memory and persisted preflight markers');

  const statInputs = { ...preflightInputs, watchedFiles: [watchedFile] };
  fs.utimesSync(watchedFile, ancient, ancient);
  const originalStatFingerprint = await buildWorkspaceCommandPreflightFingerprint(statInputs);
  fs.utimesSync(watchedFile, ancient, new Date('2000-01-02'));
  assert.notEqual(await buildWorkspaceCommandPreflightFingerprint(statInputs), originalStatFingerprint,
    'default stat mode includes mtime');
  fs.writeFileSync(watchedFile, 'longer fixture content');
  fs.utimesSync(watchedFile, ancient, ancient);
  assert.notEqual(await buildWorkspaceCommandPreflightFingerprint(statInputs), originalStatFingerprint,
    'default stat mode includes size even with unchanged mtime');
  fs.rmSync(watchedFile);
  const missingFingerprint = await buildWorkspaceCommandPreflightFingerprint(contentInputs);
  assert.notEqual(missingFingerprint, changedFingerprint, 'missing watched files have distinct fingerprints');
  assert.equal(await buildWorkspaceCommandPreflightFingerprint(contentInputs), missingFingerprint,
    'missing watched files remain deterministic');

  const systemAlias = { platform: 'darwin', lstat: () => ({ uid: 0, isSymbolicLink: () => true }),
    realpath: (prefix) => `/private${prefix}` };
  assert.equal(__resolveSystemCacheAliasForTests('/var/folders/cache', systemAlias), '/private/var/folders/cache');
  assert.equal(__resolveSystemCacheAliasForTests('/tmp/cache', systemAlias), '/private/tmp/cache');
  assert.equal(__resolveSystemCacheAliasForTests('/var/folders/cache-link/nested', systemAlias),
    '/private/var/folders/cache-link/nested', 'only the system prefix is resolved; descendant links still require validation');
  assert.equal(__resolveSystemCacheAliasForTests('/var/folders/cache', { ...systemAlias, platform: 'linux' }), '/var/folders/cache');
  assert.equal(__resolveSystemCacheAliasForTests('/var/folders/cache', { ...systemAlias,
    lstat: () => ({ uid: 501, isSymbolicLink: () => true }) }), '/var/folders/cache', 'non-root-owned alias is not trusted');
  assert.equal(__resolveSystemCacheAliasForTests('/var/folders/cache', { ...systemAlias,
    realpath: () => '/elsewhere' }), '/var/folders/cache', 'unexpected system target is not trusted');
  assert.equal(__resolveSystemCacheAliasForTests('/various/cache', systemAlias), '/various/cache', 'prefix boundary is exact');

  const unrelated = ['unrelated.json', `${'0'.repeat(40)}.json`];
  for (const name of unrelated) {
    fs.writeFileSync(path.join(probes, name), JSON.stringify({ sentinel: name }));
    fs.utimesSync(path.join(probes, name), ancient, ancient);
  }
  const assertUnrelated = () => {
    for (const name of unrelated) {
      assert.equal(fs.readFileSync(path.join(probes, name), 'utf8'), JSON.stringify({ sentinel: name }));
    }
  };
  assert.equal(writePersistentCommandProbeCache(inputs), true);
  assert.equal(readPersistentCommandProbeCache(inputs)?.ok, true, 'normal persistent cache reuse');
  const firstFile = readProbeFiles().find((name) => !unrelated.includes(name));
  const template = JSON.parse(fs.readFileSync(path.join(probes, firstFile), 'utf8'));
  fs.utimesSync(path.join(probes, firstFile), ancient, ancient);
  assert.equal(writePersistentCommandProbeCache({ ...inputs, args: ['second'] }), true);
  assert.equal(fs.existsSync(path.join(probes, firstFile)), false, 'old owned probe entry pruned');
  assertUnrelated();
  // Exercise entry-cap pruning with complete producer-shaped records, without
  // launching commands or relying on hundreds of separately spawned tests.
  for (let index = 0; index < 257; index += 1) {
    const payload = { ...template, args: [`capacity-${index}`] };
    const key = buildLocalCacheKey({ namespace: 'tooling-command-probe', version: 'tcp2', payload: {
      schemaVersion: payload.schemaVersion, providerId: payload.providerId,
      commandPath: payload.command.path, cwd: payload.cwd, args: payload.args,
      size: payload.command.size, mtimeMs: payload.command.mtimeMs
    } });
    fs.writeFileSync(path.join(probes, `${key.digest}.json`), JSON.stringify(payload));
  }
  assert.equal(writePersistentCommandProbeCache({ ...inputs, args: ['third'] }), true);
  assert.equal(readProbeFiles().length, unrelated.length + 256);
  assertUnrelated();
  const thirdArgs = { ...inputs, args: ['third'] };
  assert.equal(invalidatePersistentCommandProbeCache(thirdArgs), true);
  assert.equal(readPersistentCommandProbeCache(thirdArgs), null);

  // Unrelated content at an exact generated name is neither replaced nor
  // removed by invalidation, and symlinks/hardlinks are never cache entries.
  const collisionFile = readProbeFiles().find((name) => !unrelated.includes(name));
  const collisionPayload = JSON.parse(fs.readFileSync(path.join(probes, collisionFile), 'utf8'));
  fs.writeFileSync(path.join(probes, collisionFile), '{}');
  const collisionArgs = { ...inputs, args: collisionPayload.args };
  assert.equal(writePersistentCommandProbeCache(collisionArgs), false);
  assert.equal(invalidatePersistentCommandProbeCache(collisionArgs), false);
  assert.equal(fs.readFileSync(path.join(probes, collisionFile), 'utf8'), '{}');

  const target = path.join(outside, 'sentinel.json');
  fs.writeFileSync(target, '{"outside":true}');
  const hardlink = path.join(cache, 'hardlink.json');
  fs.linkSync(target, hardlink);
  assert.throws(() => readToolingCacheEntry(hardlink), { code: 'ERR_TOOLING_CACHE_ENTRY' });
  const checked = path.join(cache, 'checked.json');
  fs.writeFileSync(checked, '{}');
  const { stat } = readToolingCacheEntry(checked);
  fs.writeFileSync(checked, '{"changed":true}');
  assert.equal(removeToolingCacheEntry(checked, stat), false, 'changed file is not removed');
  const oversized = path.join(cache, 'oversized.json');
  const oversizedFd = fs.openSync(oversized, 'w');
  fs.ftruncateSync(oversizedFd, 8 * 1024 * 1024 + 1);
  fs.closeSync(oversizedFd);
  assert.throws(() => readToolingCacheEntry(oversized), { code: 'ERR_TOOLING_CACHE_ENTRY' });

  if (process.platform !== 'win32') {
    const fileLink = path.join(cache, 'file-link.json');
    fs.symlinkSync(target, fileLink);
    assert.throws(() => readToolingCacheEntry(fileLink), { code: 'ERR_UNSAFE_FILE_PATH' });
    await assert.rejects(() => writeToolingCacheJson(fileLink, {}), { code: 'ERR_UNSAFE_FILE_PATH' });
  }

  const linkKind = process.platform === 'win32' ? 'junction' : 'dir';
  const link = path.join(cache, 'linked');
  fs.symlinkSync(outside, link, linkKind);
  assert.throws(() => assertToolingCachePath(path.join(link, 'missing', 'cache.json')), { code: 'ERR_UNSAFE_FILE_PATH' });
  assert.throws(() => writeToolingCacheJsonSync(path.join(link, 'missing', 'cache.json'), {}), { code: 'ERR_UNSAFE_FILE_PATH' });
  await assert.rejects(() => writeToolingCacheJson(path.join(link, 'missing', 'cache.json'), {}), { code: 'ERR_UNSAFE_FILE_PATH' });
  await assert.rejects(() => persistLspRequestCache({ cachePath: path.join(link, 'requests.json'), entries: new Map(), maxEntries: 1000 }),
    { code: 'ERR_UNSAFE_FILE_PATH' });
  const coldStart = await createVfsColdStartCache({ cacheRoot: link, indexSignature: 'fixture', manifestHash: 'fixture', config: { enabled: true } });
  coldStart.set({ virtualPath: 'fixture.js', docHash: 'fixture', diskPath: command, sizeBytes: 1 });
  await assert.rejects(() => coldStart.flush(), { code: 'ERR_UNSAFE_FILE_PATH' });
  assert.equal(fs.existsSync(path.join(outside, 'missing')), false);
  fs.symlinkSync(outside, path.join(cache, 'tooling'), linkKind);
  await assert.rejects(() => writeWorkspaceCommandPreflightCacheMarker({ repoRoot: tmp, cacheRoot: cache,
    namespace: 'fixture', fingerprint: 'fixture', command: 'inert', args: [] }), { code: 'ERR_UNSAFE_FILE_PATH' });
  await assert.rejects(() => persistPyrightPlannerHealth({ repoRoot: tmp, cacheRoot: cache, workspaceRootRel: '.' }),
    { code: 'ERR_UNSAFE_FILE_PATH' });
  await assert.rejects(() => persistPyrightRuntimeHealth({ repoRoot: tmp, cacheRoot: cache, workspaceRootRel: '.', record: {} }),
    { code: 'ERR_UNSAFE_FILE_PATH' });

  const linkedCache = path.join(tmp, 'linked-cache');
  fs.mkdirSync(linkedCache);
  fs.symlinkSync(outside, path.join(linkedCache, 'command-probes'), linkKind);
  assert.equal(writePersistentCommandProbeCache({ ...inputs, toolingConfig: { cache: { dir: linkedCache } } }), false);
  assert.deepEqual(fs.readdirSync(outside), ['sentinel.json']);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"outside":true}');

  const largeCache = path.join(tmp, 'oversized-provider');
  const largeType = 'T'.repeat(8 * 1024 * 1024);
  registerToolingProvider({
    id: 'fixture-large-cache', version: '1.0.0', kinds: ['types'],
    capabilities: { supportsVirtualDocuments: true }, getConfigHash: () => 'fixture',
    async run() { return { byChunkUid: { 'chunk-1': { payload: { returnType: largeType } } } }; }
  });
  for (const generation of ['a', 'b']) {
    const result = await runToolingProviders({
      strict: true, repoRoot: tmp, buildRoot: path.join(tmp, generation), toolingConfig: {},
      cache: { enabled: true, dir: largeCache, maxBytes: 1, maxEntries: 1 }
    }, createToolingProviderFixtureInput(), ['fixture-large-cache']);
    assert.equal(result.byChunkUid.get('chunk-1')?.payload?.returnType, largeType, 'oversized provider output remains usable');
    assert.deepEqual(fs.readdirSync(path.join(largeCache, `format-${ARTIFACT_SURFACE_VERSION}`)), [], 'unreadable oversized cache entries must not accumulate');
  }
  console.log('tooling cache storage: watched-file invalidation, owned probe pruning, bounded reads and nested link protection passed');
} finally {
  TOOLING_PROVIDERS.delete('fixture-large-cache');
  fs.rmSync(tmp, { recursive: true, force: true });
}
