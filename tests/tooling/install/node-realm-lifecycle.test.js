#!/usr/bin/env node
import assert from 'node:assert/strict';
import { probeNodeRealmLifecycle } from '../../../src/shared/native-package-probe.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const [major, minor, patch] = process.versions.node.split('.').map(Number);
assert.equal(major, 26, 'the supported runtime remains Node 26');
assert.ok(minor > 12 || (minor === 12 && patch >= 1), 'use the current Node >=26.12.1 <27 baseline for worker teardown');

const result = probeNodeRealmLifecycle(process.cwd());
assert.equal(result.ok, true, result.message || 'VM worker lifecycle failed');
console.log('Node VM Script workers completed natural and terminated teardown');
