#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';
import { LANGUAGE_ROUTE_DESCRIPTORS } from '../../../src/index/language-registry/descriptors.js';
import { getLanguageForFile } from '../../../src/index/language-registry/registry.js';

applyTestEnv();

const languageIds = new Set(LANGUAGE_REGISTRY.map((entry) => entry.id));
for (const descriptor of LANGUAGE_ROUTE_DESCRIPTORS) {
  assert.ok(languageIds.has(descriptor.id), `descriptor id has no adapter: ${descriptor.id}`);
  for (const ext of descriptor.extensions || []) {
    const resolved = getLanguageForFile(ext, `src/example${ext}`);
    assert.equal(
      resolved?.id,
      descriptor.id,
      `descriptor extension route mismatch: ${descriptor.id} ${ext}`
    );
  }
  for (const filename of descriptor.specialFilenames || []) {
    const resolved = getLanguageForFile(path.extname(filename), filename);
    assert.equal(
      resolved?.id,
      descriptor.id,
      `descriptor special filename route mismatch: ${descriptor.id} ${filename}`
    );
  }
  for (const prefix of descriptor.specialPrefixes || []) {
    const fileName = `${prefix}.local`;
    const resolved = getLanguageForFile(path.extname(fileName), fileName);
    assert.equal(
      resolved?.id,
      descriptor.id,
      `descriptor special prefix route mismatch: ${descriptor.id} ${prefix}`
    );
  }
}

console.log('descriptor routing parity test passed');