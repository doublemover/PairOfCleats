#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { ensureTestingEnv } from '../helpers/test-env.js';

ensureTestingEnv(process.env);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const manifest = readJson('package.json');
const lock = readJson('package-lock.json');
const baseline = readJson('tests/fixtures/security/dependency-advisories-2026-10-02.json');

assert.equal(lock.lockfileVersion, 3, 'dependency security checks require the complete npm lock graph');
for (const field of ['dependencies', 'optionalDependencies', 'devDependencies', 'engines']) {
  assert.deepEqual(lock.packages[''][field], manifest[field], `lockfile root must match package.json ${field}`);
}
assert.ok(manifest.dependencies['@huggingface/transformers'], 'use the maintained Transformers.js package');
assert.equal(manifest.dependencies['@xenova/transformers'], undefined, 'do not restore the vulnerable v2 runtime');

const minimumNode = semver.minVersion(manifest.engines.node);
assert.ok(minimumNode && semver.gte(minimumNode, '24.15.0'), 'patched native dependencies require Node 24.15+');
const supportsTarget = (constraints, target) => !Array.isArray(constraints)
  || (!constraints.includes(`!${target}`)
    && (constraints.every((value) => value.startsWith('!')) || constraints.includes(target)));
const failures = [];
for (const [packagePath, entry] of Object.entries(lock.packages)) {
  if (!packagePath || !entry.version) continue;
  const packageName = entry.name || packagePath.split('node_modules/').at(-1);
  // GHSA-vfj7-8cjw-p6xm has no patched braces release as of 2026-10-05.
  // Keep this later advisory explicit without rewriting the historical baseline.
  if (packageName === 'braces' && semver.satisfies(entry.version, '<=3.0.3')) {
    failures.push(`${packagePath}@${entry.version}: vulnerable recursive brace expansion`);
  }
  const advisory = baseline.packages[packageName];
  if (advisory && semver.satisfies(entry.version, advisory.range, { includePrerelease: true })) {
    failures.push(`${packagePath}@${entry.version}: known vulnerable range ${advisory.range}`);
  }
  // npm skips optional binaries for other platforms (e.g. Windows ia32 Sharp
  // supports only Node 20). Security ranges above still cover every platform.
  const installedOnTarget = !entry.optional
    || (supportsTarget(entry.os, process.platform) && supportsTarget(entry.cpu, process.arch));
  if (installedOnTarget && entry.engines?.node && !semver.satisfies(minimumNode, entry.engines.node)) {
    failures.push(`${packagePath}@${entry.version}: engine ${entry.engines.node} excludes the declared minimum Node`);
  }
}
assert.deepEqual(failures, [], 'the lock graph must stay fixed and target-compatible with the minimum Node version');

const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
assert.match(workflow, /run:\s*npm audit --audit-level=low\s*\n/, 'CI must also check current advisories, including dev/optional packages');
console.log('dependency security and engine contract passed');
