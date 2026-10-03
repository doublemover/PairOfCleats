#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createStubLspCollectFixture } from './helpers/stub-lsp-collect-fixture.js';

const { chunkUid, collect } = await createStubLspCollectFixture('lsp-bychunkuid');
const result = await collect('clangd');

assert.ok(result.byChunkUid[chunkUid], 'expected LSP results keyed by chunkUid');
assert.equal(result.byChunkUid[chunkUid].chunk.chunkUid, chunkUid);

console.log('LSP byChunkUid keying test passed');
