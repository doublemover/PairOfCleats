#!/usr/bin/env node
import assert from 'node:assert/strict';
import { verifyStructuralBinaryIdentity } from '../../../src/experimental/structural/binaries.js';

assert.equal(verifyStructuralBinaryIdentity('ast-grep', { status: 0, stdout: 'sg from util-linux 2.41.0' }), false);
assert.equal(verifyStructuralBinaryIdentity('ast-grep', { status: 0, stdout: 'ast-grep 0.51.0' }), true);
assert.equal(verifyStructuralBinaryIdentity('ast-grep', { status: 0, stdout: 'Usage: sg [group] command' }), false);
assert.equal(verifyStructuralBinaryIdentity('ast-grep', { status: 1, stdout: 'ast-grep 0.51.0' }), false);
console.log('Structural engines require recognized executable identity.');
