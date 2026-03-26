#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { applyToolchainDaemonPolicyEnv } from '../../src/shared/toolchain-env.js';

const empty = applyToolchainDaemonPolicyEnv({});
assert.equal(empty.ORG_GRADLE_DAEMON, 'false');
assert.equal(empty.GRADLE_OPTS, '-Dorg.gradle.daemon=false');

const merged = applyToolchainDaemonPolicyEnv({
  ORG_GRADLE_DAEMON: 'true',
  GRADLE_OPTS: '-Xmx2g'
});
assert.equal(merged.ORG_GRADLE_DAEMON, 'false');
assert.equal(merged.GRADLE_OPTS, '-Xmx2g -Dorg.gradle.daemon=false');

const replaced = applyToolchainDaemonPolicyEnv({
  GRADLE_OPTS: '-Xmx2g -Dorg.gradle.daemon=true -Dfile.encoding=UTF-8'
});
assert.equal(
  replaced.GRADLE_OPTS,
  '-Xmx2g -Dorg.gradle.daemon=false -Dfile.encoding=UTF-8'
);

const withCacheRoot = applyToolchainDaemonPolicyEnv({
  PAIROFCLEATS_CACHE_ROOT: path.join('tmp', 'cache-root')
});
assert.equal(
  withCacheRoot.ERL_CRASH_DUMP,
  path.join('tmp', 'cache-root', 'erl_crash.dump'),
  'expected BEAM crash dumps to route into the test cache root when available'
);

const withCwdFallback = applyToolchainDaemonPolicyEnv({}, { cwd: path.join('tmp', 'workspace-root') });
assert.equal(
  withCwdFallback.ERL_CRASH_DUMP,
  path.join('tmp', 'workspace-root', 'erl_crash.dump'),
  'expected cwd fallback when no cache root is available'
);

const explicitCrashDump = applyToolchainDaemonPolicyEnv({
  ERL_CRASH_DUMP: path.join('tmp', 'custom', 'beam.dump')
}, { cwd: path.join('tmp', 'workspace-root') });
assert.equal(
  explicitCrashDump.ERL_CRASH_DUMP,
  path.join('tmp', 'custom', 'beam.dump'),
  'expected explicit ERL_CRASH_DUMP to be preserved'
);

console.log('toolchain daemon policy env test passed');
