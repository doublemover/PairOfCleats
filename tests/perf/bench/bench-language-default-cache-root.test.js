#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { parseBenchLanguageArgs } from '../../../tools/bench/language/cli.js';
import { getCacheRoot } from '../../../tools/shared/dict-utils.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const expectedDefault = path.resolve(path.join(getCacheRoot(), 'bench-language'));
const parsedDefault = parseBenchLanguageArgs([]);
assert.equal(
  parsedDefault.cacheRoot,
  expectedDefault,
  `expected bench-language default cache root to use shared cache helper (${expectedDefault})`
);

const explicitRoot = resolveTestCachePath(process.cwd(), 'bench-language-explicit-cache-root');
const parsedExplicit = parseBenchLanguageArgs(['--cache-root', explicitRoot]);
assert.equal(
  parsedExplicit.cacheRoot,
  path.resolve(explicitRoot),
  'expected explicit --cache-root to override shared default'
);

console.log('bench-language default cache root test passed');
