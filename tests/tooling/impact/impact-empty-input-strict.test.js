#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { runImpactCli } from '../../../src/integrations/tooling/impact.js';

ensureTestingEnv(process.env);

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-empty-input-'));

const payload = await runImpactCli([
  '--repo',
  repoRoot,
  '--depth',
  '1',
  '--direction',
  'downstream',
  '--json'
]);

assert.equal(payload?.ok, false, 'expected strict failure without --seed/--changed');
assert.equal(payload?.code, 'ERR_EMPTY_CHANGED_SET');
assert.ok(
  String(payload?.message || '').includes('No changed paths provided'),
  'expected actionable empty-input message'
);

console.log('impact empty-input strict behavior test passed');
