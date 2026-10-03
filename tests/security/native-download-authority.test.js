import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertTrustedExtension, extensionDownloadPolicy } from '../../tools/sqlite/extension-trust.js';
import { parseNameUrlSources } from '../../tools/shared/input-parsers.js';
import { verifyExtensions, downloadExtensions, downloadDictionaries } from '../../tools/mcp/tools/handlers/downloads.js';
import { cleanArtifacts } from '../../tools/mcp/tools/handlers/artifacts.js';
import { isPublicDownloadAddress, validateDownloadUrl, createDownloadLookup } from '../../tools/download/network-policy.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-native-policy-'));
const file = path.join(tmp, 'extension.fixture');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
try {
  fs.writeFileSync(file, 'inert native fixture, never loaded');
  const digest = hash(fs.readFileSync(file));
  const sourceHash = 'a'.repeat(64);
  const url = 'https://example.invalid/approved-archive';
  const config = { dir: tmp, provider: 'fixture', platform: 'fixture-os', arch: 'fixture-arch', platformKey: 'fixture-os-fixture-arch', filename: 'extension.fixture',
    url, downloadPolicy: { allowlist: { [url]: sourceHash } } };
  assert.throws(() => assertTrustedExtension(file, config));
  fs.writeFileSync(path.join(tmp, 'extensions.json'), JSON.stringify({ 'fixture:fixture-os-fixture-arch': {
    verified: true, url, sha256: sourceHash, outputSha256: digest, provider: config.provider, platform: config.platform, arch: config.arch, outputPath: 'extension.fixture'
  } }));
  assert.equal(assertTrustedExtension(file, config), digest);
  fs.writeFileSync(file, 'changed inert fixture');
  assert.throws(() => assertTrustedExtension(file, config), /checksum/);
  assert.equal(extensionDownloadPolicy({ security: { downloads: { requireHash: false } } }).requireHash, true);
  for (const name of ['../fixture', '..\\fixture', '/fixture', 'C:fixture', 'CON', 'x.']) {
    assert.throws(() => parseNameUrlSources(`${name}=https://example.invalid/file`, { fileNameFromName: (value) => value }));
  }
  await assert.rejects(() => downloadExtensions({ url: 'fixture=https://example.invalid/file' }), /launching user/);
  await assert.rejects(() => downloadDictionaries({ url: 'fixture=https://example.invalid/file', repoPath: process.cwd() }), /user-owned download policy/);
  assert.throws(() => verifyExtensions({ path: file }), /launching user/);
  await assert.rejects(() => cleanArtifacts({ all: true }), /all repository caches/);
  const prior = process.env.PAIROFCLEATS_MCP_ALLOW_NATIVE_LOAD;
  delete process.env.PAIROFCLEATS_MCP_ALLOW_NATIVE_LOAD;
  assert.throws(() => verifyExtensions({ load: true }), /launch-time authorization/);
  if (prior !== undefined) process.env.PAIROFCLEATS_MCP_ALLOW_NATIVE_LOAD = prior;
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1']) {
    assert.equal(isPublicDownloadAddress(address), false);
  }
  assert.equal(isPublicDownloadAddress('8.8.8.8'), true);
  assert.throws(() => validateDownloadUrl('http://example.invalid/file'), /HTTPS/);
  assert.throws(() => validateDownloadUrl('https://127.0.0.1/file'), /public/);
  assert.throws(() => validateDownloadUrl('https://unused:unused@example.invalid/file'), /credentials/);
  const lookup = createDownloadLookup({ lookup: (_host, _options, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]) });
  await new Promise((resolve) => lookup('example.invalid', {}, (error) => { assert.match(error.message, /non-public/); resolve(); }));
  console.log('native provenance, MCP authority, safe names and pinned public DNS policy passed');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
