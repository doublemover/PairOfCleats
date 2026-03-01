#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getVectorExtensionConfig, resolveVectorExtensionConfigForMode } from '../../../../tools/sqlite/vector-extension.js';

const baseConfig = getVectorExtensionConfig(process.cwd(), null, { table: 'dense_vectors_ann' });

const sharedCode = resolveVectorExtensionConfigForMode(baseConfig, 'code', { sharedDb: true });
const sharedProse = resolveVectorExtensionConfigForMode(baseConfig, 'prose', { sharedDb: true });
const unsharedCode = resolveVectorExtensionConfigForMode(baseConfig, 'code', { sharedDb: false });

assert.equal(baseConfig.table, 'dense_vectors_ann', 'base table should remain unchanged');
assert.equal(sharedCode.table, 'dense_vectors_ann_code', 'shared db should suffix code table');
assert.equal(sharedProse.table, 'dense_vectors_ann_prose', 'shared db should suffix prose table');
assert.equal(unsharedCode.table, baseConfig.table, 'unshared db should keep base table');

console.log('sqlite ann table scoping test passed');
