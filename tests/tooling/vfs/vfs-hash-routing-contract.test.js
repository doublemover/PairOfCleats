#!/usr/bin/env node
import assert from 'node:assert/strict';
import { checksumString } from '../../../src/shared/hash.js';
import * as mod from '../../../src/index/tooling/vfs-hash-routing.js';
const buildVfsRoutingToken = mod.buildVfsRoutingToken || mod.resolveVfsRoutingToken;
assert.equal(typeof buildVfsRoutingToken, 'function', 'Expected buildVfsRoutingToken export.');

assert.equal(
  mod.VFS_HASH_ROUTING_SCHEMA_VERSION,
  '1.0.0',
  'Expected VFS hash routing schema version 1.0.0.'
);

const virtualPath = '.poc-vfs/src/app.ts#seg:segu:v1:abc.ts';
const docHash = 'xxh64:0123456789abcdef';
const routingKey = `${docHash}|${virtualPath}`;
const expectedHash = await checksumString(routingKey);
const expectedToken = expectedHash?.value || '';

const token = await buildVfsRoutingToken({
  virtualPath,
  docHash,
  mode: 'docHash+virtualPath'
});

assert.equal(token, expectedToken, 'Expected routing token to be xxh64(routingKey).');
assert.ok(/^[0-9a-f]{16}$/.test(token), 'Routing token should be lowercase hex (xxh64).');

console.log('VFS hash routing contract ok.');
