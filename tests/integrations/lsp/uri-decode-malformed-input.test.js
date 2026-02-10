#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  buildVfsTokenUri,
  decodeVfsVirtualPath,
  parseVfsTokenUri,
  registerVfsTokenMapping
} from '../../../src/integrations/tooling/lsp/uris.js';

applyTestEnv();

const malformedPath = '%E0%A4%A';
assert.equal(decodeVfsVirtualPath(malformedPath), null, 'malformed decode should fail closed');

registerVfsTokenMapping('tok-malformed', 'src/safe.py');
const malformedParsed = parseVfsTokenUri(`poc-vfs:///${malformedPath}?token=tok-malformed`);
assert.equal(malformedParsed?.virtualPath, 'src/safe.py');
assert.equal(malformedParsed?.token, 'tok-malformed');

const validUri = buildVfsTokenUri({ virtualPath: 'src/ok.py', token: 'tok-valid' });
const validParsed = parseVfsTokenUri(validUri);
assert.equal(validParsed?.virtualPath, 'src/ok.py');
assert.equal(validParsed?.token, 'tok-valid');

console.log('LSP URI malformed decode guard test passed');
