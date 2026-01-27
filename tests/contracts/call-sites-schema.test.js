#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validateArtifact } from '../../src/shared/artifact-schemas.js';

const valid = [
  {
    callSiteId: 'sha1:0123456789abcdef0123456789abcdef01234567',
    callerChunkUid: 'chunku:demo',
    callerDocId: 1,
    file: 'src/demo.ts',
    languageId: 'typescript',
    segmentId: null,
    start: 10,
    end: 20,
    startLine: 1,
    startCol: 1,
    endLine: 1,
    endCol: 11,
    calleeRaw: 'demo.run',
    calleeNormalized: 'run',
    receiver: 'demo',
    args: ['foo', 'bar'],
    evidence: ['ast'],
    snippetHash: 'sha1:0123456789abcdef0123456789abcdef01234567'
  }
];

const validResult = validateArtifact('call_sites', valid);
assert.ok(validResult.ok, `call_sites valid entry should pass: ${validResult.errors?.join('; ')}`);

const invalid = [
  {
    callerChunkUid: 'chunku:demo',
    file: 'src/demo.ts',
    languageId: 'typescript',
    start: 10,
    end: 20,
    startLine: 1,
    startCol: 1,
    endLine: 1,
    endCol: 11,
    calleeRaw: 'demo.run',
    calleeNormalized: 'run',
    args: []
  }
];
const invalidResult = validateArtifact('call_sites', invalid);
assert.ok(!invalidResult.ok, 'call_sites missing callSiteId should fail');

console.log('call_sites schema test passed');
