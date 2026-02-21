#!/usr/bin/env node
import assert from 'node:assert/strict';
import { listDispatchManifest } from '../../src/shared/dispatch/manifest.js';

const manifest = listDispatchManifest();
assert(Array.isArray(manifest), 'manifest list must be an array');
assert(manifest.length > 0, 'manifest list must not be empty');

const ids = manifest.map((entry) => entry.id);
const sorted = ids.slice().sort((a, b) => a.localeCompare(b));
assert.deepEqual(ids, sorted, 'manifest list should be sorted by id');

const required = ['search', 'index.build', 'setup', 'bootstrap', 'tui.supervisor'];
for (const id of required) {
  assert(ids.includes(id), `manifest list should include ${id}`);
}

console.log('dispatch manifest list test passed');
