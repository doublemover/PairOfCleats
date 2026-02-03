#!/usr/bin/env node
import assert from 'node:assert/strict';
import { checksumString } from '../../../src/shared/hash.js';
import { buildVfsRoutingToken } from '../../../src/index/tooling/vfs-hash-routing.js';

const virtualPath = '.poc-vfs/src/app.ts#seg:segu:v1:abc.ts';
const docHash = 'xxh64:0123456789abcdef';

const expectedCombined = (await checksumString(`${docHash}|${virtualPath}`)).value;
const tokenCombined = await buildVfsRoutingToken({ virtualPath, docHash });
assert.equal(tokenCombined, expectedCombined, 'Expected routing token for docHash+virtualPath.');
assert.ok(/^[0-9a-f]{16}$/.test(tokenCombined), 'Expected routing token to be lowercase hex.');

const expectedDocOnly = (await checksumString(docHash)).value;
const tokenDocOnly = await buildVfsRoutingToken({ virtualPath, docHash, mode: 'docHash' });
assert.equal(tokenDocOnly, expectedDocOnly, 'Expected routing token for docHash-only mode.');

const missing = await buildVfsRoutingToken({ virtualPath, docHash: null });
assert.equal(missing, null, 'Expected null token when docHash is missing.');

console.log('vfs hash routing token ok');
