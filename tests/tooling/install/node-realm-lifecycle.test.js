#!/usr/bin/env node
import assert from 'node:assert/strict';
import { probeNodeRealmLifecycle } from '../../../src/shared/native-package-probe.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const [major, minor] = process.versions.node.split('.').map(Number);
assert.equal(major, 26, 'the supported runtime remains Node 26');
assert.ok(minor >= 10, 'Node 26.8.1 has a confirmed cppgc Realm use-after-free at Worker teardown');

const result = probeNodeRealmLifecycle(process.cwd());
assert.equal(result.ok, true, result.message || 'VM worker lifecycle failed');
console.log('Node VM Script workers completed natural and terminated teardown');
