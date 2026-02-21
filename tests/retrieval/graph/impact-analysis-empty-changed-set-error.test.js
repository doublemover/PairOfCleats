#!/usr/bin/env node
import assert from 'node:assert';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildImpactAnalysis, IMPACT_EMPTY_CHANGED_SET_CODE } from '../../../src/graph/impact.js';

ensureTestingEnv(process.env);

let threw = false;
try {
  buildImpactAnalysis({
    changed: [],
    direction: 'downstream',
    depth: 1
  });
} catch (err) {
  threw = true;
  assert.equal(err?.code, IMPACT_EMPTY_CHANGED_SET_CODE, 'expected strict empty changed-set code');
}

assert.equal(threw, true, 'expected buildImpactAnalysis to throw for empty changed set');

console.log('impact analysis empty changed-set strict error test passed');
