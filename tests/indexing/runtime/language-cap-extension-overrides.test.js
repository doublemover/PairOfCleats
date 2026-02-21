#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveFileCapsAndGuardrails } from '../../../src/index/build/runtime/caps.js';
import { resolveFileCaps } from '../../../src/index/build/file-processor/read.js';

applyTestEnv();

const { fileCaps } = resolveFileCapsAndGuardrails({
  maxFileBytes: 5 * 1024 * 1024,
  fileCaps: {}
});

const jsCaps = resolveFileCaps(fileCaps, '.js', 'javascript', 'code');
assert.equal(jsCaps.maxBytes, 320 * 1024, 'expected strict .js maxBytes baseline');
assert.equal(jsCaps.maxLines, 5200, 'expected strict .js maxLines baseline');

const mjsCaps = resolveFileCaps(fileCaps, '.mjs', 'javascript', 'code');
assert.equal(mjsCaps.maxBytes, 320 * 1024, 'expected strict .mjs maxBytes baseline');
assert.equal(mjsCaps.maxLines, 5200, 'expected strict .mjs maxLines baseline');

const cjsCaps = resolveFileCaps(fileCaps, '.cjs', 'javascript', 'code');
assert.equal(cjsCaps.maxBytes, 320 * 1024, 'expected strict .cjs maxBytes baseline');
assert.equal(cjsCaps.maxLines, 5200, 'expected strict .cjs maxLines baseline');

const tsCaps = resolveFileCaps(fileCaps, '.ts', 'typescript', 'code');
assert.equal(tsCaps.maxBytes, 384 * 1024, 'expected strict .ts maxBytes baseline');
assert.equal(tsCaps.maxLines, 6500, 'expected strict .ts maxLines baseline');

const mtsCaps = resolveFileCaps(fileCaps, '.mts', 'typescript', 'code');
assert.equal(mtsCaps.maxBytes, 384 * 1024, 'expected strict .mts maxBytes baseline');
assert.equal(mtsCaps.maxLines, 6500, 'expected strict .mts maxLines baseline');

const ctsCaps = resolveFileCaps(fileCaps, '.cts', 'typescript', 'code');
assert.equal(ctsCaps.maxBytes, 384 * 1024, 'expected strict .cts maxBytes baseline');
assert.equal(ctsCaps.maxLines, 6500, 'expected strict .cts maxLines baseline');

const jsxCaps = resolveFileCaps(fileCaps, '.jsx', 'javascript', 'code');
assert.equal(jsxCaps.maxBytes, 256 * 1024, 'expected strict .jsx maxBytes baseline');
assert.equal(jsxCaps.maxLines, 3600, 'expected strict .jsx maxLines baseline');

const tsxCaps = resolveFileCaps(fileCaps, '.tsx', 'typescript', 'code');
assert.equal(tsxCaps.maxBytes, 288 * 1024, 'expected strict .tsx maxBytes baseline');
assert.equal(tsxCaps.maxLines, 4200, 'expected strict .tsx maxLines baseline');

const vueCaps = resolveFileCaps(fileCaps, '.vue', null, 'code');
assert.equal(vueCaps.maxBytes, 256 * 1024, 'expected .vue maxBytes baseline');
assert.equal(vueCaps.maxLines, 3500, 'expected .vue maxLines baseline');

const svelteCaps = resolveFileCaps(fileCaps, '.svelte', null, 'code');
assert.equal(svelteCaps.maxBytes, 224 * 1024, 'expected .svelte maxBytes baseline');
assert.equal(svelteCaps.maxLines, 3200, 'expected .svelte maxLines baseline');

const astroCaps = resolveFileCaps(fileCaps, '.astro', null, 'code');
assert.equal(astroCaps.maxBytes, 256 * 1024, 'expected .astro maxBytes baseline');
assert.equal(astroCaps.maxLines, 3600, 'expected .astro maxLines baseline');

console.log('language cap extension override test passed');
