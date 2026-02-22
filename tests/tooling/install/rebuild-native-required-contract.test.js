#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'setup', 'rebuild-native.js');
const packagePath = path.join(root, 'package.json');

const script = fs.readFileSync(scriptPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const parseStringArray = (label) => {
  const match = script.match(new RegExp(`const\\s+${label}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  assert.ok(match, `missing ${label} in rebuild-native.js`);
  return Array.from(match[1].matchAll(/'([^']+)'/g)).map((entry) => entry[1]);
};

const required = parseStringArray('REQUIRED_NATIVE_PACKAGES');
const optional = parseStringArray('OPTIONAL_NATIVE_PACKAGES');
const directDeps = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {})
]);

assert.equal(required.includes('sharp'), false, 'sharp must not be required for rebuild:native');
assert.equal(optional.includes('sharp'), true, 'sharp should be optional for rebuild:native');
assert.equal(required.includes('tree-sitter'), true, 'tree-sitter should be required for rebuild:native');

for (const dep of required) {
  assert.equal(
    directDeps.has(dep),
    true,
    `required rebuild package must be declared directly in package.json: ${dep}`
  );
}

console.log('rebuild native required contract test passed');
