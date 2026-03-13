#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as mod from '../../../src/integrations/tooling/lsp/uris.js';
const buildVfsTokenUri = mod.buildVfsTokenUri || mod.buildVfsUri;
assert.equal(typeof buildVfsTokenUri, 'function', 'Expected buildVfsTokenUri export.');

const virtualPath = '.poc-vfs/docs/hello%world#v2.md#seg:segu:v1:abc.ts';
const token = 'abcdef0123456789';
const uri = buildVfsTokenUri({ virtualPath, token });

assert.ok(uri.startsWith('poc-vfs:///'), 'Expected poc-vfs scheme.');
assert.ok(uri.includes('token=abcdef0123456789'), 'Expected token query parameter.');
assert.ok(uri.includes('%23'), 'Expected # to be percent-encoded in the path.');
assert.ok(!uri.includes('#seg:'), 'Expected raw segment marker to be encoded.');

console.log('VFS token URI contract ok.');
