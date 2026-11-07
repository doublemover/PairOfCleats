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
  ...Object.keys(pkg.optionalDependencies || {}),
  // Locked bootstrap includes dev dependencies, including the PTY qualifier.
  ...Object.keys(pkg.devDependencies || {})
]);

assert.equal(required.includes('sharp'), false, 'sharp must not be required for rebuild:native');
assert.equal(optional.includes('sharp'), true, 'sharp should be optional for rebuild:native');
assert.equal(required.includes('tree-sitter'), true, 'tree-sitter should be required for rebuild:native');
assert.equal(required.includes('node-pty'), true, 'required terminal qualification must probe natural PTY disposal');

for (const dep of required) {
  assert.equal(
    directDeps.has(dep),
    true,
    `required rebuild package must be declared directly in package.json: ${dep}`
  );
}

if (process.platform === 'win32') {
  // Inspect the actual node-gyp project produced by locked bootstrap, rather
  // than a copied command fixture: downloaded headers select <arch>/node.lib.
  const project = fs.readFileSync(path.join(root, 'node_modules/tree-sitter/build/tree_sitter_runtime_binding.vcxproj'), 'utf8')
    .replaceAll('\\\\', '\\');
  const library = path.join(root, '.cache/native-build/headers', process.versions.node, process.arch, 'node.lib');
  assert.ok(project.includes(library), 'actual Windows binding must link the installed architecture library');
  assert.ok(fs.statSync(library).size > 0, 'selected import library must exist');
  assert.equal(project.includes(path.join(root, '.cache/native-build/headers', process.versions.node, 'Release/node.lib')), false,
    'a downloaded header cache is not a Node source checkout');
}

console.log('rebuild native required contract test passed');
