#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const scripts = Object.keys(pkg.scripts || {}).sort();

const expectedScripts = [
  'audit:duplicates',
  'bootstrap',
  'bootstrap:ci',
  'config:budget',
  'env:check',
  'format',
  'lint',
  'postinstall',
  'release:verify',
  'test',
  'test:api',
  'test:ci',
  'test:ci-lite',
  'test:ci-long',
  'test:lane-audit',
  'test:refresh-governance',
  'test:perf',
  'test:services',
  'test:storage',
  'verify',
  'verify:production'
].sort();

assert.deepEqual(
  scripts,
  expectedScripts,
  'package.json should expose only the curated contributor npm surface'
);

console.log('contributor script surface test passed');
