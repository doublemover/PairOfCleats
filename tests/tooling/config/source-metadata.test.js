#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadUserConfig } from '../../../tools/dict-utils/config.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-config-sources-'));
const repo = path.join(temp, 'repo');
fs.mkdirSync(repo);
let sources;
const read = env => loadUserConfig(repo, { env, onSources: value => { sources = value; } });
try {
  assert.deepEqual(read({}), {});
  assert.equal(sources.files[0].exists, false);
  fs.writeFileSync(path.join(repo, '.pairofcleats.json'), '{}');
  assert.deepEqual(read({}), {});
  assert.equal(sources.files[0].exists, true);
  assert.match(sources.files[0].contentHash, /^[a-f0-9]{64}$/);
  fs.writeFileSync(path.join(repo, '.pairofcleats.json'), JSON.stringify({
    cache: { root: './untrusted' }, models: { id: 'repo-model' }, runtime: { nodeOptions: '--trace-warnings' }
  }));
  assert.equal(read({}).cache.root, undefined);
  assert.deepEqual(sources.discardedAuthorityPaths.sort(), ['cache.root', 'runtime.nodeOptions']);
  assert.equal(sources.files[0].contentHash, null);
  assert.equal(sources.files[0].contentHashOmitted, 'sensitive-source');
  const trusted = path.join(temp, 'trusted.json');
  fs.writeFileSync(trusted, JSON.stringify({ models: { id: 'trusted-model' } }));
  assert.equal(read({ PAIROFCLEATS_TRUSTED_CONFIG: trusted }).models.id, 'trusted-model');
  assert.equal(sources.trustedMerge, true);
  assert.equal(sources.files[1].source, 'trusted-external');
  assert.equal(read({ PAIROFCLEATS_TEST_CONFIG: '{"models":{"id":"ignored"}}' }).models.id, 'repo-model');
  assert.equal(sources.testOverlay.applied, false);
  const testEnv = applyTestEnv({ syncProcess: false, testConfig: { models: { id: 'test-model' } } });
  assert.equal(read(testEnv).models.id, 'test-model');
  assert.equal(sources.testOverlay.applied, true);
  assert.ok(!JSON.stringify(sources).includes('--trace-warnings'));
  console.log('configuration source metadata test passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
