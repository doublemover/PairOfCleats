#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveUsrRuntimeConfig } from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const policyPath = path.join(root, 'tests', 'lang', 'matrix', 'usr-runtime-config-policy.json');
const policyPayload = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

const validResult = resolveUsrRuntimeConfig({
  policyPayload,
  strictMode: true,
  layers: {
    policyFile: {
      'usr.parser.maxSegmentMs': '2000'
    },
    env: {
      'usr.fallback.allowHeuristic': 'off',
      'usr.parser.maxSegmentMs': '2500'
    },
    argv: {
      'usr.parser.maxSegmentMs': '3000'
    }
  }
});

assert.equal(validResult.ok, true, 'expected valid layered overrides to resolve cleanly');
assert.equal(validResult.values['usr.parser.maxSegmentMs'], 3000, 'expected argv layer to win for parser max segment');
assert.equal(validResult.appliedByKey['usr.parser.maxSegmentMs'], 'argv', 'expected source attribution for parser max segment override');
assert.equal(validResult.values['usr.fallback.allowHeuristic'], false, 'expected boolean coercion from env override');
assert.equal(validResult.appliedByKey['usr.fallback.allowHeuristic'], 'env', 'expected source attribution for fallback boolean override');

const invalidResult = resolveUsrRuntimeConfig({
  policyPayload,
  strictMode: true,
  layers: {
    argv: {
      'usr.parser.maxSegmentMs': '99999',
      'usr.unknown.flag': '1'
    }
  }
});

assert.equal(invalidResult.ok, false, 'expected strict mode to fail on invalid and unknown runtime config keys');
assert(
  invalidResult.errors.some((entry) => entry.includes('usr.parser.maxSegmentMs') && entry.includes('above maxValue')),
  'expected strict-mode error for integer override above maxValue'
);
assert(
  invalidResult.errors.some((entry) => entry.includes('unknown runtime config key at argv: usr.unknown.flag')),
  'expected strict-mode error for unknown runtime config key'
);

const nonStrictResult = resolveUsrRuntimeConfig({
  policyPayload,
  strictMode: false,
  layers: {
    policyFile: {
      'usr.parser.maxSegmentMs': '1800'
    },
    env: {
      'usr.parser.maxSegmentMs': 'oops'
    },
    argv: {
      'usr.unknown.flag': '1'
    }
  }
});

assert.equal(nonStrictResult.ok, true, 'expected non-strict mode to surface resolver issues as warnings');
assert.equal(nonStrictResult.errors.length, 0, 'expected non-strict mode to avoid blocking errors for invalid overrides');
assert.equal(
  nonStrictResult.values['usr.parser.maxSegmentMs'],
  1800,
  'expected invalid higher-precedence override to preserve last valid value'
);
assert.equal(
  nonStrictResult.appliedByKey['usr.parser.maxSegmentMs'],
  'policy-file',
  'expected source attribution to remain at last valid layer when higher layer fails'
);
assert(
  nonStrictResult.warnings.some((entry) => entry.includes('invalid runtime config value for usr.parser.maxSegmentMs at env')),
  'expected warning for non-strict invalid override'
);
assert(
  nonStrictResult.warnings.some((entry) => entry.includes('unknown runtime config key at argv: usr.unknown.flag')),
  'expected warning for unknown runtime key in non-strict mode'
);

console.log('usr runtime config resolution test passed');
