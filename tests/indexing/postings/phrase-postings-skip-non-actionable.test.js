#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { appendChunk, createIndexState } from '../../../src/index/build/state.js';

applyTestEnv();

const PHRASE_POSTINGS_CONFIG = {
  phraseSource: 'full',
  phraseMinN: 2,
  phraseMaxN: 3,
  phraseHash: false,
  enablePhraseNgrams: true
};

const buildStateWithChunk = (chunk) => {
  const state = createIndexState({ postingsConfig: PHRASE_POSTINGS_CONFIG });
  appendChunk(state, chunk, PHRASE_POSTINGS_CONFIG);
  return state;
};

const cmakeState = buildStateWithChunk({
  file: 'src/CMakeLists.txt',
  tokens: ['target_link_libraries', 'opencv_core', 'pthread'],
  seq: ['target_link_libraries', 'opencv_core', 'pthread']
});
assert.equal(cmakeState.phrasePost.size, 0, 'expected CMakeLists phrase postings to be skipped');
assert.ok(cmakeState.tokenPostings.size > 0, 'expected token postings to remain enabled for CMakeLists');

const licenseState = buildStateWithChunk({
  file: 'docs/python-license.txt',
  tokens: ['licensed', 'under', 'apache', 'license'],
  seq: ['licensed', 'under', 'apache', 'license'],
  docmeta: {
    boilerplateTags: ['boilerplate:license', 'license:apache']
  }
});
assert.equal(licenseState.phrasePost.size, 0, 'expected license boilerplate phrase postings to be skipped');
assert.ok(licenseState.tokenPostings.size > 0, 'expected token postings to remain enabled for license files');

const sourceState = buildStateWithChunk({
  file: 'src/main.cpp',
  tokens: ['cv', 'mat', 'create'],
  seq: ['cv', 'mat', 'create']
});
assert.ok(sourceState.phrasePost.size > 0, 'expected phrase postings to remain enabled for regular source files');

const fixtureState = buildStateWithChunk({
  file: 'fastlane/spec/fixtures/requests/github_releases.json',
  tokens: ['assets', 'browser_download_url', 'created_at'],
  seq: ['assets', 'browser_download_url', 'created_at']
});
assert.equal(fixtureState.phrasePost.size, 0, 'expected fixture phrase postings to be skipped');

const makefileState = buildStateWithChunk({
  file: 'contrib/minizip/Makefile.in',
  tokens: ['prefix', 'exec_prefix', 'includedir'],
  seq: ['prefix', 'exec_prefix', 'includedir']
});
assert.equal(makefileState.phrasePost.size, 0, 'expected build scaffolding phrase postings to be skipped');

const generatedDocsState = buildStateWithChunk({
  file: 'docs/Classes.html',
  tokens: ['class', 'protocol', 'declaration'],
  seq: ['class', 'protocol', 'declaration']
});
assert.equal(generatedDocsState.phrasePost.size, 0, 'expected generated docs phrase postings to be skipped');

const licensePathState = buildStateWithChunk({
  file: 'LICENSES/GPL-3.0-only.txt',
  tokens: ['gnu', 'general', 'public', 'license'],
  seq: ['gnu', 'general', 'public', 'license']
});
assert.equal(licensePathState.phrasePost.size, 0, 'expected license path phrase postings to be skipped');

const docsMarkdownState = buildStateWithChunk({
  file: 'docs/guide.md',
  tokens: ['quickstart', 'index', 'search'],
  seq: ['quickstart', 'index', 'search']
});
assert.ok(docsMarkdownState.phrasePost.size > 0, 'expected regular docs markdown phrase postings to remain enabled');

console.log('phrase postings skip non-actionable test passed');
