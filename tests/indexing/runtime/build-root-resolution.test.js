#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveRuntimeBuildRoot } from '../../../src/index/build/runtime/config.js';

let existsCalls = 0;
/**
 * `existsSync` returns true twice to force build-id collision suffixing.
 */
const resolved = resolveRuntimeBuildRoot({
  resolvedIndexRoot: null,
  buildsRoot: path.join(process.cwd(), '.tmp-runtime-builds'),
  scmHeadId: 'abcdef1234567890',
  configHash: '0123456789abcdef',
  existsSync: () => {
    existsCalls += 1;
    return existsCalls <= 2;
  }
});

assert.ok(resolved.buildId.endsWith('_2'), 'expected collision loop to append second suffix');
assert.equal(path.basename(resolved.buildRoot), resolved.buildId, 'expected build root basename to match build id');

const overrideRoot = path.join(process.cwd(), '.tmp-runtime-builds-override');
const override = resolveRuntimeBuildRoot({
  resolvedIndexRoot: overrideRoot,
  buildsRoot: path.join(process.cwd(), '.tmp-runtime-builds'),
  scmHeadId: null,
  configHash: null,
  existsSync: () => {
    throw new Error('existsSync should not run when index root override is provided');
  }
});

assert.equal(override.buildRoot, overrideRoot, 'expected explicit index root override');
assert.equal(override.buildId, path.basename(overrideRoot), 'expected build id derived from override basename');

console.log('runtime build root resolution test passed');
