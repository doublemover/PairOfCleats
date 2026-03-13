#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../helpers/test-env.js';
import {
  normalizeFailureEvent,
  validateFailureEvent
} from '../../src/index/build/failure-taxonomy.js';

ensureTestingEnv(process.env);

const normalized = normalizeFailureEvent({
  category: 'artifact-io',
  message: 'vfs reader is closed',
  phase: 'processing',
  stage: 'stage1',
  file: 'lib/example.rb',
  shardId: null
});

const validation = validateFailureEvent(normalized);
assert.equal(validation.ok, true, `expected null shardId to validate: ${validation.errors.join('; ')}`);
assert.ok(
  normalized.hints.every((hint) => !String(hint).includes('shard=')),
  'expected null shardId to be omitted from synthesized hints'
);

console.log('failure taxonomy null shard test passed');
