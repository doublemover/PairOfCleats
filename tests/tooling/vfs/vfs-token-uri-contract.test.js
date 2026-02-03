#!/usr/bin/env node
import assert from 'node:assert/strict';

const loadModule = async () => {
  try {
    return await import('../../../src/integrations/tooling/lsp/uris.js');
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' || String(err?.message || '').includes('Cannot find module')) {
      console.log('Skipping VFS token URI contract (TODO: implement src/integrations/tooling/lsp/uris.js).');
      process.exit(0);
    }
    throw err;
  }
};

const mod = await loadModule();
const buildVfsTokenUri = mod.buildVfsTokenUri || mod.buildVfsUri;
if (typeof buildVfsTokenUri !== 'function') {
  console.log('Skipping VFS token URI contract (TODO: export buildVfsTokenUri).');
  process.exit(0);
}

const virtualPath = '.poc-vfs/docs/hello%world#v2.md#seg:segu:v1:abc.ts';
const token = 'abcdef0123456789';
const uri = buildVfsTokenUri({ virtualPath, token });

assert.ok(uri.startsWith('poc-vfs:///'), 'Expected poc-vfs scheme.');
assert.ok(uri.includes('token=abcdef0123456789'), 'Expected token query parameter.');
assert.ok(uri.includes('%23'), 'Expected # to be percent-encoded in the path.');
assert.ok(!uri.includes('#seg:'), 'Expected raw segment marker to be encoded.');

console.log('VFS token URI contract ok.');
