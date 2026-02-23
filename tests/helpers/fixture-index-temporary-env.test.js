#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fixtureIndexInternals } from './fixture-index.js';

const key = 'TEST_TMP_FIXTURE_ENV';
const keyAdded = 'TEST_TMP_FIXTURE_ENV_ADDED';
const previous = process.env[key];
const previousAdded = process.env[keyAdded];
process.env[key] = 'keep-me';
delete process.env[keyAdded];

try {
  await fixtureIndexInternals.withTemporaryEnv(
    {
      [key]: undefined,
      [keyAdded]: 'temporary'
    },
    async () => {
      assert.equal(process.env[key], undefined, 'expected undefined override to delete env var during callback');
      assert.equal(process.env[keyAdded], 'temporary', 'expected temporary value during callback');
    }
  );

  assert.equal(process.env[key], 'keep-me', 'expected deleted env var to be restored');
  assert.equal(process.env[keyAdded], undefined, 'expected temporary env var to be removed after callback');
  console.log('fixture-index temporary env test passed');
} finally {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
  if (previousAdded === undefined) delete process.env[keyAdded];
  else process.env[keyAdded] = previousAdded;
}
