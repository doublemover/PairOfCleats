#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../src/index/tooling/doctor.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'tooling-doctor-missing-ts');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

registerDefaultToolingProviders();
const report = await runToolingDoctor({
  repoRoot: root,
  buildRoot: tempRoot,
  toolingConfig: {
    dir: path.join(tempRoot, '.tooling'),
    typescript: { enabled: true, resolveOrder: ['cache'], useTsconfig: false }
  },
  strict: false
}, ['typescript'], { log: () => {} });

const providers = Array.isArray(report.providers) ? report.providers : [];
const tsProvider = providers.find((entry) => entry.id === 'typescript');
assert.equal(tsProvider?.status, 'error', 'expected TypeScript provider error when module missing');

console.log('tooling doctor missing TypeScript test passed');
