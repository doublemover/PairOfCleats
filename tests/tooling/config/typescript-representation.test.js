#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getToolingConfig } from '../../../tools/shared/dict-utils.js';

const root = process.cwd();
assert.equal(getToolingConfig(root, {}).typescript.typeRepresentation, 'legacy');
for (const mode of ['legacy', 'symbolic']) {
  assert.equal(getToolingConfig(root, { tooling: { typescript: { typeRepresentation: mode } } })
    .typescript.typeRepresentation, mode, 'canonical runtime config must retain the selected backend');
}
for (const mode of [null, '', 'Legacy', 'best-effort', true, 1, {}]) {
  assert.throws(() => getToolingConfig(root, { tooling: { typescript: { typeRepresentation: mode } } }),
    { code: 'ERR_TYPESCRIPT_TYPE_REPRESENTATION' }, 'unknown values must not silently become legacy');
}
console.log('TypeScript representation survives canonical config loading with validated defaults');
