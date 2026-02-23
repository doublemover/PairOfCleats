#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { getToolingRegistry } from '../../../tools/tooling/utils.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const toolingRoot = resolveTestCachePath(root, 'tooling-registry-pyright');
const registry = getToolingRegistry(toolingRoot, root);
const pyright = registry.find((tool) => tool && tool.id === 'pyright');

assert.ok(pyright, 'expected pyright entry in tooling registry');
assert.equal(
  pyright.detect?.cmd,
  'pyright-langserver',
  'pyright tooling detection must use pyright-langserver'
);
assert.ok(
  Array.isArray(pyright.detect?.args) && pyright.detect.args.includes('--help'),
  'pyright-langserver detection should include --help probe'
);

console.log('tooling registry pyright detection test passed');
