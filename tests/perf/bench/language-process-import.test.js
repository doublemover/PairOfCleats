#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createProcessRunner } from '../../../tools/bench/language/process.js';

assert.equal(typeof createProcessRunner, 'function');

console.log('bench language process import test passed');
