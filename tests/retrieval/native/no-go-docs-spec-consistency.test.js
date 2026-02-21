#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { NATIVE_ACCEL_DECISION } from '../../../src/shared/native-accel.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const specPath = path.join(root, 'docs', 'specs', 'native-accel.md');
const perfPath = path.join(root, 'docs', 'perf', 'native-accel.md');
const archivedPath = path.join(root, 'docs', 'archived', 'native-accel-adoption-go-path.md');

const spec = fs.readFileSync(specPath, 'utf8');
const perf = fs.readFileSync(perfPath, 'utf8');
const archived = fs.readFileSync(archivedPath, 'utf8');

assert.equal(spec.includes('Final (No-Go)'), true, 'spec must declare no-go final status');
assert.equal(spec.includes(NATIVE_ACCEL_DECISION.decision), true, 'spec must match runtime decision');
assert.equal(perf.includes('Final (No-Go)'), true, 'perf doc must declare no-go final status');
assert.equal(archived.includes('# DEPRECATED'), true, 'archived go-path doc must include deprecation header');

console.log('native no-go docs/spec consistency test passed');
