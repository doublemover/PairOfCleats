#!/usr/bin/env node
import assert from 'node:assert/strict';
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

console.log('toolchain daemon policy env test passed');
