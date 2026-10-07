#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-structured-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const resolveCommandProfile = ({ cmd, args = [] }) => ({
  providerId: 'dart',
  requested: { cmd, args },
  resolved: { cmd, args, mode: 'mock', reason: 'test' },
  probe: {
    ok: true,
    attempted: [{
      args: ['--version'],
      exitCode: 0,
      stdout: 'dart sdk version: 3.0.0-test'
    }],
    versionText: 'dart sdk version: 3.0.0-test',
    failureReasons: []
  }
});

registerDefaultToolingProviders();
const report = await runToolingDoctor({
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['dart'],
    dart: { cmd: 'dart' }
  },
  strict: false
}, ['dart'], {
  log: () => {},
  probeHandshake: false,
  resolveCommandProfile
});

const dart = report.providers.find((entry) => entry.id === 'dart');
assert.ok(dart, 'expected dart provider in doctor report');
assert.equal(dart.command?.resolved?.cmd, 'dart', 'expected resolved command in report');
assert.equal(
  dart.command?.probe?.versionText,
  'dart sdk version: 3.0.0-test',
  'expected machine-readable command version text'
);
assert.ok(dart.workspaceModel && typeof dart.workspaceModel === 'object', 'expected structured workspace model block');
assert.equal(dart.workspaceModel.detected, false, 'expected missing workspace model for empty repo');
assert.equal(dart.workspaceModel.status, 'warn', 'expected workspace model warning status');
assert.ok(Array.isArray(dart.failureReasons), 'expected structured failure reasons array');
assert.equal(
  dart.failureReasons.some((entry) => entry?.code === 'dart-workspace-model' && entry?.status === 'warn'),
  true,
  'expected workspace-model warning in structured failure reasons'
);

console.log('tooling doctor structured report fields test passed');
