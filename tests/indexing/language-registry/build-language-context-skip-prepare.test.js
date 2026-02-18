#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildLanguageContext } from '../../../src/index/language-registry/registry.js';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';

const jsLang = LANGUAGE_REGISTRY.find((entry) => entry?.id === 'javascript');
assert.ok(jsLang && typeof jsLang.prepare === 'function', 'expected javascript adapter prepare function');

const originalPrepare = jsLang.prepare;
let prepareCalls = 0;

jsLang.prepare = async () => {
  prepareCalls += 1;
  return {};
};

try {
  await buildLanguageContext({
    ext: '.js',
    relPath: 'docs/example.js',
    mode: 'prose',
    text: 'const answer = 42;',
    options: {}
  });
  assert.equal(prepareCalls, 0, 'expected prose mode to skip prepare by default');

  await buildLanguageContext({
    ext: '.js',
    relPath: 'src/example.js',
    mode: 'code',
    text: 'const answer = 42;',
    options: {}
  });
  assert.equal(prepareCalls, 1, 'expected code mode to call prepare');

  await buildLanguageContext({
    ext: '.js',
    relPath: 'docs/force-prepare.js',
    mode: 'prose',
    text: 'const answer = 42;',
    options: { forcePrepare: true }
  });
  assert.equal(prepareCalls, 2, 'expected forcePrepare to call prepare in prose mode');

  await buildLanguageContext({
    ext: '.js',
    relPath: 'src/skip-prepare.js',
    mode: 'code',
    text: 'const answer = 42;',
    options: { skipPrepare: true }
  });
  assert.equal(prepareCalls, 2, 'expected skipPrepare to bypass prepare in code mode');
} finally {
  jsLang.prepare = originalPrepare;
}

console.log('language registry buildLanguageContext skipPrepare test passed');
