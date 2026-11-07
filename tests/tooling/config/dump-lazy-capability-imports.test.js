import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { explainEffectiveConfiguration } from '../../../tools/config/effective.js';
import { sanitizeRuntimeReceipt } from '../../../src/shared/runtime-envelope/receipt.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { initGitRepo } from '../../helpers/git-fixture.js';

const { dir } = await prepareIsolatedTestCacheDir('dump-lazy-capabilities'), repo = path.join(dir, 'repo');
await fs.mkdir(repo); initGitRepo(repo);
await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{"quality":"fast","threads":2}\n');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off',
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const payloadUrl = new URL('../../../tools/config/dump-payload.js', import.meta.url).href;
const capabilityUrl = new URL('../../../src/shared/capabilities.js', import.meta.url).href;
const manifestUrl = new URL('../../../src/shared/runtime-capability-manifest.js', import.meta.url).href;
const requested = [], loaded = new Set();
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context); loaded.add(resolved.url);
    if (context.parentURL === payloadUrl && [capabilityUrl, manifestUrl].includes(resolved.url)) requested.push(resolved.url);
    return resolved;
  }
});
try {
  const { buildConfigurationDump } = await import(payloadUrl);
  const preview = await buildConfigurationDump({ repoRoot: repo, env });
  console.log(JSON.stringify({ defaultPreviewModuleRequests: requested, resolvedModules: loaded.size }));
  assert.deepEqual(requested, [], 'an ordinary config preview must not link unrequested capability/report surfaces');
  assert.equal(preview.ok, true);
  assert.equal(preview.userConfig.threads, 2);
  assert.equal(preview.derived.mcp.capabilityProbe, 'not-requested');
  assert.equal(preview.derived.mcp.sdkAvailable, null);
  assert.equal(Object.hasOwn(preview.derived, 'capabilityManifest'), false);

  const canonical = await explainEffectiveConfiguration({ repoRoot: repo, env });
  assert.equal(canonical.ok, true);
  const explicit = await buildConfigurationDump({ repoRoot: repo, env, includeCapabilities: true }, { explain: async () => canonical });
  assert.equal(explicit.ok, true);
  assert.equal(explicit.derived.mcp.capabilityProbe, 'requested');
  assert.ok(requested.includes(capabilityUrl)); assert.ok(requested.includes(manifestUrl));
  const { getCapabilities } = await import(capabilityUrl), { getRuntimeCapabilityManifest } = await import(manifestUrl);
  const capabilities = getCapabilities();
  assert.equal(explicit.derived.mcp.sdkAvailable, Boolean(capabilities.mcp?.sdk));
  assert.deepEqual(explicit.derived.capabilityManifest,
    sanitizeRuntimeReceipt(getRuntimeCapabilityManifest({ runtimeCapabilities: capabilities })),
    'explicit capability reports retain the complete original canonical content');
  assert.deepEqual(explicit.preview, canonical.preview);
  assert.deepEqual(explicit.configSources, canonical.configSources);

  let probes = 0;
  const supplied = { mcp: { sdk: true } }, suppliedManifest = { fixture: 'explicit-owned-provider' };
  const injected = await buildConfigurationDump({ repoRoot: repo, env, includeCapabilities: true }, {
    explain: async () => canonical, capabilities: () => { probes++; return supplied; },
    manifest: input => { assert.equal(input.runtimeCapabilities, supplied); return suppliedManifest; }
  });
  assert.equal(probes, 1); assert.equal(injected.derived.mcp.sdkAvailable, true);
  assert.deepEqual(injected.derived.capabilityManifest, suppliedManifest);
  const rejected = { ok: false, errorCode: 'fixture-config-rejection' };
  assert.equal(await buildConfigurationDump({ repoRoot: repo, env, includeCapabilities: true }, {
    explain: async () => rejected, capabilities: () => assert.fail('rejected configuration cannot activate providers')
  }), rejected);
} finally {
  hooks.deregister();
  const relative = path.relative(process.cwd(), dir);
  assert.ok(relative.startsWith(`.tmp${path.sep}`) && !relative.startsWith('..'));
  await fs.rm(dir, { recursive: true, force: true });
}
