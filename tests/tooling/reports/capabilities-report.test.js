#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getCapabilities } from '../../../src/shared/capabilities.js';

const caps = getCapabilities({ refresh: true });

assert.ok(caps && typeof caps === 'object', 'capabilities should be an object');
assert.equal(typeof caps.watcher?.chokidar, 'boolean', 'watcher.chokidar should be boolean');
assert.equal(typeof caps.watcher?.parcel, 'boolean', 'watcher.parcel should be boolean');
assert.equal(typeof caps.regex?.re2, 'boolean', 'regex.re2 should be boolean');
assert.equal(typeof caps.regex?.re2js, 'boolean', 'regex.re2js should be boolean');
assert.equal(typeof caps.hash?.nodeRsXxhash, 'boolean', 'hash.nodeRsXxhash should be boolean');
assert.equal(typeof caps.hash?.wasmXxhash, 'boolean', 'hash.wasmXxhash should be boolean');
assert.equal(typeof caps.compression?.gzip, 'boolean', 'compression.gzip should be boolean');
assert.equal(typeof caps.compression?.zstd, 'boolean', 'compression.zstd should be boolean');
assert.equal(typeof caps.extractors?.pdf, 'boolean', 'extractors.pdf should be boolean');
assert.equal(typeof caps.extractors?.docx, 'boolean', 'extractors.docx should be boolean');
assert.equal(typeof caps.mcp?.legacy, 'boolean', 'mcp.legacy should be boolean');
assert.equal(typeof caps.mcp?.sdk, 'boolean', 'mcp.sdk should be boolean');
assert.equal(typeof caps.externalBackends?.tantivy, 'boolean', 'externalBackends.tantivy should be boolean');
assert.equal(typeof caps.externalBackends?.lancedb, 'boolean', 'externalBackends.lancedb should be boolean');

console.log('capabilities report tests passed');
