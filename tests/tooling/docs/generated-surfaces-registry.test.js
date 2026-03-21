#!/usr/bin/env node
import { ensureTestingEnv } from '../../helpers/test-env.js';
import fs from 'node:fs';
import path from 'node:path';

ensureTestingEnv(process.env);

const root = process.cwd();
const registryPath = path.join(root, 'docs', 'tooling', 'generated-surfaces.json');

if (!fs.existsSync(registryPath)) {
  console.error(`generated surfaces registry test failed: missing ${registryPath}`);
  process.exit(1);
}

const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const surfaces = Array.isArray(registry?.surfaces) ? registry.surfaces : [];
const requiredIds = [
  'script-inventory',
  'repo-inventory',
  'doc-contract-drift',
  'config-contract',
  'config-inventory',
  'artifact-schema-index'
];

for (const id of requiredIds) {
  const surface = surfaces.find((entry) => entry?.id === id);
  if (!surface) {
    console.error(`generated surfaces registry test failed: missing ${id}`);
    process.exit(1);
  }
  if (!surface.owner || !surface.validationMode || !surface.freshnessExpectation) {
    console.error(`generated surfaces registry test failed: ${id} missing metadata`);
    process.exit(1);
  }
  if (!surface.refresh?.command) {
    console.error(`generated surfaces registry test failed: ${id} missing refresh command`);
    process.exit(1);
  }
  const outputs = Array.isArray(surface.outputs) ? surface.outputs : [];
  if (!outputs.length) {
    console.error(`generated surfaces registry test failed: ${id} missing outputs`);
    process.exit(1);
  }
}

console.log('generated surfaces registry test passed');
