import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { observeProviderProfile, providerProfileCacheIdentity, verifyProviderProfileReceipt } from '../../../src/index/tooling/provider-profile.js';

// Authored source regression. No executables are launched by observation.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-provider-profile-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const source = 'local value = 1\n';
  await fs.writeFile(path.join(root, 'source.lua'), source);
  await fs.writeFile(path.join(root, 'tool.bin'), 'tool bytes v1');
  await fs.writeFile(path.join(root, 'project.json'), '{}');
  await fs.writeFile(path.join(root, 'sdk.json'), 'sdk-1');
  const options = { repoRoot: root, providerId: 'lua-example', adapterVersion: '1', apiProfile: 'lsp-3.17',
    configuredCommand: ['lua-language-server'], resolvedCommand: [path.join(root, 'tool.bin')],
    observedVersion: '3.18.0', toolFiles: [{ path: 'tool.bin' }],
    sourceInputs: [{ path: 'source.lua', hash: hash(source) }], capabilities: ['definition'], dependencyClosure: 'complete',
    project: { files: [{ path: 'project.json' }], sdkFiles: [{ path: 'sdk.json' }],
      dependencies: [{ path: 'missing.lua', absent: true }], targets: ['source.lua'] } };
  const first = await observeProviderProfile(options);
  assert.equal(first.durable, true);
  assert.equal(providerProfileCacheIdentity(first, { providerId: options.providerId, adapterVersion: '1', repoRoot: root }), first.profileHash);
  assert.ok(Object.isFrozen(first.tool.files[0]));
  assert.equal(await verifyProviderProfileReceipt(JSON.parse(JSON.stringify(first))), first.profileHash,
    'a serialized receipt needs a fresh bounded verification of every observed file');
  const unknown = await observeProviderProfile({ ...options, dependencyClosure: 'unknown' });
  assert.equal(unknown.durable, false);
  assert.equal(providerProfileCacheIdentity(unknown, { providerId: options.providerId, adapterVersion: '1' }), null);
  await fs.writeFile(path.join(root, 'tool.bin'), 'tool bytes v2');
  await assert.rejects(verifyProviderProfileReceipt(first), /checksum|identity|changed/iu,
    'cached provenance cannot silently reuse a changed executable');
  const changed = await observeProviderProfile(options);
  assert.notEqual(first.tool.hash, changed.tool.hash, 'same self-reported version cannot hide changed executable bytes');
  const mismatch = await observeProviderProfile({ ...options, expectedToolHash: first.tool.hash });
  assert.ok(mismatch.reasons.includes('install_runtime_identity_mismatch'));
  await fs.writeFile(path.join(root, 'sdk.json'), 'sdk-2');
  const sdk = await observeProviderProfile(options);
  assert.notEqual(sdk.profileHash, changed.profileHash, 'SDK-only changes invalidate provenance');
  await fs.writeFile(path.join(root, 'project.json'), '{"dialect":"LuaJIT"}');
  const config = await observeProviderProfile(options);
  assert.notEqual(config.profileHash, sdk.profileHash);
  await fs.writeFile(path.join(root, 'missing.lua'), 'return {}');
  await assert.rejects(verifyProviderProfileReceipt(config), { code: 'ERR_TOOLING_PROFILE_IDENTITY' },
    'fresh verification rechecks negative dependencies');
  await assert.rejects(observeProviderProfile(options), { code: 'ERR_TOOLING_PROFILE_IDENTITY' });
  await fs.writeFile(path.join(root, 'source.lua'), source + '-- changed');
  await assert.rejects(observeProviderProfile(options), /hash|checksum|changed/iu);
  const revoked = new AbortController(); revoked.abort();
  await assert.rejects(observeProviderProfile({ ...options, signal: revoked.signal }), { name: 'AbortError' });
  console.log('observed provider bytes, source/project/SDK and negative dependency identities');
} finally { await fs.rm(root, { recursive: true, force: true }); }
