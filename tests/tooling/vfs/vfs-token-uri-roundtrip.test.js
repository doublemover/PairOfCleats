#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildVfsToken,
  buildVfsTokenUri,
  parseVfsTokenUri
} from '../../../src/integrations/tooling/lsp/uris.js';

const virtualPath = '.poc-vfs/docs/hello%world#seg:segu:v1:abc.ts';
const docHash = 'xxh64:0123456789abcdef';

const token = await buildVfsToken({ virtualPath, docHash, mode: 'docHash+virtualPath' });
assert.ok(/^[0-9a-f]{16}$/.test(token), 'Expected xxh64 token hex.');

const uri = buildVfsTokenUri({ virtualPath, token });
assert.ok(uri.startsWith('poc-vfs:///'), 'Expected poc-vfs scheme.');
assert.ok(uri.includes('token='), 'Expected token query parameter.');

const parsed = parseVfsTokenUri(uri);
assert.equal(parsed?.virtualPath, virtualPath, 'Expected virtualPath roundtrip.');
assert.equal(parsed?.token, token, 'Expected token roundtrip.');

console.log('VFS token URI roundtrip ok');
