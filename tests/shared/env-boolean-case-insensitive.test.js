#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  getDownloadEnvConfig,
  getEnvConfig,
  isMcpNativeLoadEnabled,
  isStrictDispatchEnvEnabled,
  setCacheRootEnv,
  setEmbeddingsEnv
} from '../../src/shared/env/runtime.js';
import { getBenchTestEnvConfig } from '../../src/shared/env/testing.js';
import { getTuiWorkspaceRoot } from '../../src/shared/env/tui.js';

const config = getEnvConfig({
  PAIROFCLEATS_CACHE_REBUILD: 'TRUE',
  PAIROFCLEATS_VERBOSE: 'YeS',
  PAIROFCLEATS_DEBUG_CRASH: 'On',
  PAIROFCLEATS_DEBUG_PERF_EVENTS: 'false',
  PAIROFCLEATS_DENSE_BINARY_MAX_INLINE_MB: '256'
});

assert.equal(config.cacheRebuild, true, 'expected uppercase TRUE to be treated as true');
assert.equal(config.verbose, true, 'expected mixed-case YeS to be treated as true');
assert.equal(config.debugCrash, true, 'expected On to be treated as true');
assert.equal(config.debugPerfEvents, false, 'expected false to remain false');
assert.equal(config.denseBinaryMaxInlineMb, 256, 'expected dense binary inline limit to normalize to number');

for (const value of ['1', 'true', 'TRUE', ' YeS ', 'On']) {
  assert.equal(isStrictDispatchEnvEnabled({ PAIROFCLEATS_DISPATCH_STRICT: value }), true);
}
for (const value of [undefined, '', '0', 'false', 'off', 'not-a-boolean']) {
  assert.equal(isStrictDispatchEnvEnabled({ PAIROFCLEATS_DISPATCH_STRICT: value }), false);
}

for (const value of [undefined, '', '0', 'true', 'TRUE', 'yes', 'on', ' 1 ', '01', 1, true]) {
  assert.equal(getDownloadEnvConfig({ PAIROFCLEATS_ALLOW_LOCAL_DOWNLOADS: value }).allowLocal, false,
    `local-download authorization must reject ${String(value)}`);
  assert.equal(isMcpNativeLoadEnabled({ PAIROFCLEATS_MCP_ALLOW_NATIVE_LOAD: value }), false,
    `native-loading authorization must reject ${String(value)}`);
}
assert.equal(getDownloadEnvConfig({ PAIROFCLEATS_ALLOW_LOCAL_DOWNLOADS: '1' }).allowLocal, true);
assert.equal(isMcpNativeLoadEnabled({ PAIROFCLEATS_MCP_ALLOW_NATIVE_LOAD: '1' }), true);
assert.deepEqual(getDownloadEnvConfig({}), { allowLocal: false, redirectOriginsJson: '[]' });
for (const raw of ['["https://approved.example"]', '{"not":"an array"}', 'invalid JSON']) {
  assert.equal(getDownloadEnvConfig({ PAIROFCLEATS_DOWNLOAD_REDIRECT_ORIGINS: raw }).redirectOriginsJson, raw,
    'the download owner must retain JSON parsing and per-origin validation');
}

for (const testing of [undefined, '', '0', 'true', 'TRUE', ' 1 ', 1, true]) {
  assert.deepEqual(getBenchTestEnvConfig({
    PAIROFCLEATS_TESTING: testing,
    PAIROFCLEATS_TEST_BENCH_SELF_INTERRUPT_AFTER_MS: '150',
    PAIROFCLEATS_TEST_BENCH_REPO_DELAY_MS: '250'
  }), { testing: false, selfInterruptAfterMs: null, repoDelayMs: null });
}
assert.deepEqual(getBenchTestEnvConfig({
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_TEST_BENCH_SELF_INTERRUPT_AFTER_MS: '150.5',
  PAIROFCLEATS_TEST_BENCH_REPO_DELAY_MS: '250'
}), { testing: true, selfInterruptAfterMs: 150.5, repoDelayMs: 250 });
assert.deepEqual(getBenchTestEnvConfig({
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_TEST_BENCH_SELF_INTERRUPT_AFTER_MS: 'invalid',
  PAIROFCLEATS_TEST_BENCH_REPO_DELAY_MS: 'Infinity'
}), { testing: true, selfInterruptAfterMs: null, repoDelayMs: null });

assert.equal(getTuiWorkspaceRoot({}), '');
assert.equal(getTuiWorkspaceRoot({ PAIROFCLEATS_TUI_WORKSPACE_ROOT: '/workspace/path with spaces ' }),
  '/workspace/path with spaces ', 'wrapper workspace paths must not be trimmed');

for (const [key, setter] of [
  ['PAIROFCLEATS_CACHE_ROOT', setCacheRootEnv],
  ['PAIROFCLEATS_EMBEDDINGS', setEmbeddingsEnv]
]) {
  for (const original of [undefined, '', ' original value ']) {
    const env = original === undefined ? {} : { [key]: original };
    const previous = setter('override', env);
    assert.equal(previous, original, 'temporary overrides must return the raw prior value');
    assert.equal(env[key], 'override');
    setter(previous, env);
    assert.equal(env[key], original);
    assert.equal(Object.hasOwn(env, key), original !== undefined,
      'restoring an absent value must remove the property');
  }
}

const originalEmbeddings = setEmbeddingsEnv('stub');
try {
  assert.equal(getEnvConfig().embeddings, 'stub', 'default accessors must read the live launch environment');
} finally {
  setEmbeddingsEnv(originalEmbeddings);
}

console.log('env boolean, launch authority and temporary override accessor tests passed');
