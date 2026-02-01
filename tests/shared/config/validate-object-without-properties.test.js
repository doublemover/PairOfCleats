#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validateConfig } from '../../../src/config/validate.js';

const schema = {
  type: 'object',
  required: ['alpha'],
  additionalProperties: false
};

const result = validateConfig(schema, { beta: 1 });
assert.equal(result.ok, false, 'expected validation to fail');
assert.ok(result.errors.some((err) => err.includes('#/alpha is required')));
assert.ok(result.errors.some((err) => err.includes('#/beta is not allowed')));

const okResult = validateConfig(schema, { alpha: 1 });
assert.equal(okResult.ok, true, 'expected validation to pass when required key present');

console.log('config validate object without properties test passed');
